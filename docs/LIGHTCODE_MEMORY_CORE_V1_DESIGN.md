# LightCode Memory Core V1 — Technical Design

**Status**: Active  
**Phase**: Design (Phase 2 of 6)  
**Date**: 2026-04-05  
**Depends On**: `LIGHTCODE_MEMORY_CORE_V1_SPEC.md`

---

## Table of Contents

1. [Module Boundaries](#module-boundaries)
2. [Core Architecture](#core-architecture)
3. [Database Design](#database-design)
4. [Working Memory Design](#working-memory-design)
5. [Observational Memory Design](#observational-memory-design)
6. [Semantic Recall Design](#semantic-recall-design)
7. [Fork and Handoff Design](#fork-and-handoff-design)
8. [Runtime Integration Design](#runtime-integration-design)
9. [Migration Design](#migration-design)
10. [Context Assembly Design](#context-assembly-design)

---

## Module Boundaries

### Overview

```
packages/opencode/src/
├── memory/                          ← NEW: LightCode Memory Core V1
│   ├── contracts.ts                 ← Internal types/interfaces (no deps on DB)
│   ├── schema.sql.ts                ← Drizzle schema for new memory tables
│   ├── working-memory.ts            ← WorkingMemoryService
│   ├── semantic-recall.ts           ← SemanticRecallService
│   ├── handoff.ts                   ← HandoffService (fork + agent handoff)
│   ├── provider.ts                  ← MemoryProvider (composes all 4 layers)
│   └── index.ts                     ← Public exports
├── session/
│   ├── om/                          ← EXISTING (preserved, extended)
│   │   ├── record.ts                ← Extended: adds durability guards
│   │   ├── buffer.ts                ← UNCHANGED
│   │   ├── observer.ts              ← UNCHANGED
│   │   ├── reflector.ts             ← UNCHANGED
│   │   ├── groups.ts                ← UNCHANGED
│   │   └── index.ts                 ← UNCHANGED
│   ├── system.ts                    ← MODIFIED: recall() uses MemoryProvider
│   └── prompt.ts                    ← MODIFIED: context assembly via MemoryProvider
└── dream/
    ├── index.ts                     ← MODIFIED: writes to MemoryProvider not Engram MCP
    └── engram.ts                    ← DEPRECATED (see migration doc)
```

### Module Dependency Rules

```
contracts.ts
    ↑
schema.sql.ts          (depends on: contracts.ts)
    ↑
working-memory.ts      (depends on: contracts.ts, schema.sql.ts, storage/db.ts)
semantic-recall.ts     (depends on: contracts.ts, schema.sql.ts, storage/db.ts)
handoff.ts             (depends on: contracts.ts, schema.sql.ts, storage/db.ts)
    ↑
provider.ts            (depends on: contracts.ts, working-memory.ts, semantic-recall.ts,
                                    handoff.ts, session/om/)
    ↑
session/system.ts      (depends on: provider.ts)
session/prompt.ts      (depends on: provider.ts)
dream/index.ts         (depends on: provider.ts)
```

**Critical rule**: `memory/` modules MUST NOT import from `session/` (except `session/om/` for the observational memory integration). This prevents circular dependency chains.

---

## Core Architecture

### MemoryProvider Interface

```typescript
// memory/contracts.ts

export type MemoryScope = "thread" | "agent" | "project" | "user" | "global_pattern"

export interface ScopeRef {
  type: MemoryScope
  id: string // thread ULID / agent ID / project path / user ID / pattern key
}

export interface MemoryContext {
  recentHistory: string | undefined // from session/message tables
  workingMemory: string | undefined // assembled from WM records for this scope chain
  observations: string | undefined // from OM record for this thread
  semanticRecall: string | undefined // from semantic recall index
  continuationHint: string | undefined // suggested_continuation from OM record
  totalTokens: number
}

export interface ContextBuildOptions {
  scope: ScopeRef // primary scope (usually thread)
  ancestorScopes?: ScopeRef[] // e.g. [agent, project, user] for inheritance
  recentHistoryLimit?: number // message count cap
  workingMemoryBudget?: number // token cap for WM
  observationsBudget?: number // token cap for OM
  semanticRecallBudget?: number // token cap for semantic recall
  semanticQuery?: string // query for semantic recall (usually recent user msg)
  includeGlobalPatterns?: boolean
}

export interface WorkingMemoryRecord {
  id: string
  scope_type: MemoryScope
  scope_id: string
  key: string // logical key within the scope
  value: string // markdown or JSON string
  format: "markdown" | "json"
  version: number
  time_created: number
  time_updated: number
}

export interface ObservationRecord {
  id: string
  session_id: string
  observations: string | null
  reflections: string | null
  current_task: string | null
  suggested_continuation: string | null
  last_observed_at: number | null
  generation_count: number
  observation_tokens: number
  observed_message_ids: string | null // JSON array of message IDs
  time_created: number
  time_updated: number
}

export interface ObservationBuffer {
  id: string
  session_id: string
  observations: string
  first_msg_id: string | null
  last_msg_id: string | null
  starts_at: number
  ends_at: number
}

export interface MemoryArtifact {
  id: string
  scope_type: MemoryScope
  scope_id: string
  type: "observation" | "working_memory" | "handoff" | "pattern" | "decision"
  title: string
  content: string
  topic_key: string | null
  normalized_hash: string | null
  revision_count: number
  duplicate_count: number
  last_seen_at: number | null
  deleted_at: number | null
  time_created: number
  time_updated: number
}

export interface AgentHandoff {
  id: string
  parent_session_id: string
  child_session_id: string
  context: string // serialized context snapshot
  working_memory_snapshot: string | null // WM state at fork time
  observation_snapshot: string | null // OM state at fork time
  metadata: string | null // JSON metadata
  time_created: number
}

export interface ForkContext {
  id: string
  session_id: string // child session
  parent_session_id: string
  context: string
  time_created: number
}

export interface MemoryLink {
  id: string
  from_artifact_id: string
  to_artifact_id: string
  relation: "derived_from" | "supersedes" | "related_to"
  time_created: number
}

export interface MemoryProvider {
  buildContext(opts: ContextBuildOptions): Promise<MemoryContext>
  getWorkingMemory(scope: ScopeRef, key?: string): Promise<WorkingMemoryRecord[]>
  setWorkingMemory(scope: ScopeRef, key: string, value: string, format?: "markdown" | "json"): Promise<void>
  getObservations(sessionId: string): Promise<ObservationRecord | undefined>
  searchArtifacts(query: string, scopes: ScopeRef[], limit?: number): Promise<MemoryArtifact[]>
  indexArtifact(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): Promise<string>
  getHandoff(childSessionId: string): Promise<AgentHandoff | undefined>
  writeHandoff(handoff: Omit<AgentHandoff, "id" | "time_created">): Promise<string>
  getForkContext(sessionId: string): Promise<ForkContext | undefined>
  writeForkContext(ctx: Omit<ForkContext, "id" | "time_created">): Promise<string>
}
```

### MemoryProvider Implementation Pattern

```typescript
// memory/provider.ts (structure)

export namespace Memory {
  export function buildContext(opts: ContextBuildOptions): Promise<MemoryContext> {
    // 1. Load observations from OM.get(scope.id) [thread scope]
    // 2. Load working memory from WorkingMemory.get(scope)
    // 3. Load semantic recall from SemanticRecall.search(opts.semanticQuery, scopes)
    // 4. Recent history is NOT loaded here — caller supplies it (already in session/prompt.ts)
    // 5. Assemble context with token budgets
    // 6. Return MemoryContext
  }
}
```

---

## Database Design

### New Tables (Additive Migration)

All new tables are added as additive migrations to the existing `lightcode.db`. No existing tables are modified or dropped.

#### `memory_working`

Stores structured working memory records per scope.

```sql
CREATE TABLE IF NOT EXISTS memory_working (
  id          TEXT PRIMARY KEY,
  scope_type  TEXT NOT NULL,              -- 'thread' | 'agent' | 'project' | 'user' | 'global_pattern'
  scope_id    TEXT NOT NULL,              -- thread ULID / agent ID / project path / user ID / pattern key
  key         TEXT NOT NULL,              -- logical key within the scope (e.g. 'project_state', 'user_prefs')
  value       TEXT NOT NULL,              -- markdown or JSON string
  format      TEXT NOT NULL DEFAULT 'markdown',
  version     INTEGER NOT NULL DEFAULT 1,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wm_scope_key ON memory_working(scope_type, scope_id, key);
CREATE INDEX IF NOT EXISTS idx_wm_scope ON memory_working(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_wm_updated ON memory_working(time_updated DESC);
```

#### `memory_artifacts`

Stores indexed memory artifacts for semantic recall. Borrows Engram's best storage patterns.

```sql
CREATE TABLE IF NOT EXISTS memory_artifacts (
  id              TEXT PRIMARY KEY,
  scope_type      TEXT NOT NULL,
  scope_id        TEXT NOT NULL,
  type            TEXT NOT NULL,          -- 'observation' | 'working_memory' | 'handoff' | 'pattern' | 'decision'
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  topic_key       TEXT,
  normalized_hash TEXT,
  revision_count  INTEGER NOT NULL DEFAULT 1,
  duplicate_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at    INTEGER,
  deleted_at      INTEGER,
  time_created    INTEGER NOT NULL,
  time_updated    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_art_scope ON memory_artifacts(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_art_topic ON memory_artifacts(topic_key, scope_type, scope_id, time_updated DESC);
CREATE INDEX IF NOT EXISTS idx_art_type ON memory_artifacts(type);
CREATE INDEX IF NOT EXISTS idx_art_hash ON memory_artifacts(normalized_hash, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_art_deleted ON memory_artifacts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_art_created ON memory_artifacts(time_created DESC);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memory_artifacts_fts USING fts5(
  title,
  content,
  topic_key,
  type,
  scope_type,
  scope_id,
  content='memory_artifacts',
  content_rowid='rowid'
);

-- FTS sync triggers
CREATE TRIGGER IF NOT EXISTS art_fts_insert AFTER INSERT ON memory_artifacts BEGIN
  INSERT INTO memory_artifacts_fts(rowid, title, content, topic_key, type, scope_type, scope_id)
  VALUES (new.rowid, new.title, new.content, new.topic_key, new.type, new.scope_type, new.scope_id);
END;

CREATE TRIGGER IF NOT EXISTS art_fts_delete AFTER DELETE ON memory_artifacts BEGIN
  INSERT INTO memory_artifacts_fts(memory_artifacts_fts, rowid, title, content, topic_key, type, scope_type, scope_id)
  VALUES ('delete', old.rowid, old.title, old.content, old.topic_key, old.type, old.scope_type, old.scope_id);
END;

CREATE TRIGGER IF NOT EXISTS art_fts_update AFTER UPDATE ON memory_artifacts BEGIN
  INSERT INTO memory_artifacts_fts(memory_artifacts_fts, rowid, title, content, topic_key, type, scope_type, scope_id)
  VALUES ('delete', old.rowid, old.title, old.content, old.topic_key, old.type, old.scope_type, old.scope_id);
  INSERT INTO memory_artifacts_fts(rowid, title, content, topic_key, type, scope_type, scope_id)
  VALUES (new.rowid, new.title, new.content, new.topic_key, new.type, new.scope_type, new.scope_id);
END;
```

#### `memory_agent_handoffs`

Stores durable parent → child agent handoff context.

```sql
CREATE TABLE IF NOT EXISTS memory_agent_handoffs (
  id                    TEXT PRIMARY KEY,
  parent_session_id     TEXT NOT NULL,
  child_session_id      TEXT NOT NULL UNIQUE,
  context               TEXT NOT NULL,             -- serialized context snapshot
  working_memory_snap   TEXT,                      -- WM JSON at fork time
  observation_snap      TEXT,                      -- OM text at fork time
  metadata              TEXT,                      -- JSON metadata
  time_created          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_handoff_child ON memory_agent_handoffs(child_session_id);
CREATE INDEX IF NOT EXISTS idx_handoff_parent ON memory_agent_handoffs(parent_session_id);
```

#### `memory_fork_contexts`

Stores durable fork context for session continuation after restart.

```sql
CREATE TABLE IF NOT EXISTS memory_fork_contexts (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL UNIQUE,          -- child session
  parent_session_id TEXT NOT NULL,
  context           TEXT NOT NULL,
  time_created      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fork_session ON memory_fork_contexts(session_id);
```

#### `memory_links`

Stores relationships between memory artifacts.

```sql
CREATE TABLE IF NOT EXISTS memory_links (
  id               TEXT PRIMARY KEY,
  from_artifact_id TEXT NOT NULL,
  to_artifact_id   TEXT NOT NULL,
  relation         TEXT NOT NULL,                  -- 'derived_from' | 'supersedes' | 'related_to'
  time_created     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_link_from ON memory_links(from_artifact_id);
CREATE INDEX IF NOT EXISTS idx_link_to ON memory_links(to_artifact_id);
```

### Existing Tables — No Changes

The following existing tables are preserved exactly as-is:

- `session` — unchanged
- `message` — unchanged
- `part` — unchanged
- `todo` — unchanged
- `permission` — unchanged
- `session_observation` (ObservationTable) — unchanged schema
- `session_observation_buffer` (ObservationBufferTable) — unchanged schema

---

## Working Memory Design

### Storage Model

Working memory is stored in `memory_working` with a composite unique key on `(scope_type, scope_id, key)`.

Each scope can have multiple keys. Examples:

| Scope            | scope_id               | key             | Description                |
| ---------------- | ---------------------- | --------------- | -------------------------- |
| `project`        | `/home/user/myproject` | `project_state` | Current project status     |
| `project`        | `/home/user/myproject` | `decisions`     | Architecture decisions     |
| `user`           | `default`              | `preferences`   | User preferences           |
| `thread`         | `sess_abc123`          | `current_task`  | What we're doing right now |
| `global_pattern` | `typescript-patterns`  | `patterns`      | Reusable TS patterns       |

### Update Model

```typescript
// WorkingMemory.set(scope, key, value)
// → SELECT id FROM memory_working WHERE scope_type=? AND scope_id=? AND key=?
// → IF found: UPDATE SET value=?, version=version+1, time_updated=?
// → IF not found: INSERT
// All operations are transactional.
```

### Versioning

Every update increments `version` and sets `time_updated`. No history is stored in V1 — the latest version wins. Future versions could add a `memory_working_history` table.

### Prompt Injection Rules

Working memory is injected into the system prompt as a structured block:

```
<working-memory scope="project">
{value}
</working-memory>
```

Multiple keys for the same scope are concatenated with a separator. The injection respects the `workingMemoryBudget` token cap.

**Scope order for prompt injection** (most specific first):

1. `thread` (if present)
2. `agent` (if agent scope provided)
3. `project` (if project scope provided)
4. `user` (if user scope provided)
5. `global_pattern` (if enabled)

### Per-Scope Behavior

- `thread`: prompt-injectable, cleared when thread is deleted
- `agent`: prompt-injectable, persists across agent sessions
- `project`: prompt-injectable, shared across all sessions in a project
- `user`: prompt-injectable, user-wide facts
- `global_pattern`: prompt-injectable only if `includeGlobalPatterns: true` in build options; no project-private data

---

## Observational Memory Design

### Existing OM Pipeline — Preserved

The current OM pipeline in `session/om/` is preserved as-is:

- `OMBuf.check()` — token threshold state machine
- `Observer.run()` — LLM-driven observation extraction
- `OM.upsert()` — write observation record to DB
- `Reflector.run()` — condense observations at reflection threshold

### Durability Guard — New

**Critical invariant**: do not mark anything as observed before durable persistence succeeds.

Current code in `session/prompt.ts` calls `OM.upsert()` to write and then updates the in-memory seal via `OMBuf.seal()`. The risk is that if `OM.upsert()` fails silently, the seal still advances and those messages are permanently excluded from future observation attempts.

**Fix**: wrap the upsert in a transaction. If the DB write fails, throw and do NOT advance the seal. The OM buffer state machine will retry on the next threshold crossing.

```typescript
// Durability-safe observation write pattern
function observeSafe(sid: SessionID, rec: ObservationRecord, sealAt: number): void {
  Database.transaction((tx) => {
    // 1. Write observation record
    tx.insert(ObservationTable).values(rec).onConflictDoUpdate({ target: ObservationTable.id, set: rec }).run()
    // 2. Only if write succeeds, advance seal
    OMBuf.seal(sid, sealAt) // this is now called inside the transaction
  })
  // If transaction throws, seal is NOT advanced
}
```

### Observation Thresholds

Thresholds are unchanged from existing implementation:

- `INTERVAL`: 6,000 tokens → emit `"buffer"` signal
- `DEFAULT_RANGE`: `{ min: 80_000, max: 140_000 }` → emit `"activate"` signal
- `BLOCK_AFTER`: 180,000 tokens → emit `"block"` signal

### Buffering Behavior

The existing `addBuffer` and `activate` methods in `OM` namespace are dead code paths. They are documented as future async pre-compute but not wired. This design connects them:

1. When signal is `"buffer"`: call `Observer.runBackground(sid, messages)` → store result in `ObservationBufferTable` via `OM.addBuffer()`
2. When signal is `"activate"`: call `OM.activate(sid)` → merge buffered observations + write to `ObservationTable`
3. `"block"` signal: stop accepting new messages until activation completes

This is the Mastra-style async buffering pattern.

### Activation Behavior

`OM.activate()` (existing code) merges all buffer chunks via `Observer.condense()`, writes to `ObservationTable`, and clears buffers. The durability guard ensures this is atomic.

### BlockAfter Safety

`BLOCK_AFTER = 180_000` tokens. When this threshold is crossed, the run loop must pause new message processing until the observer completes. Current code emits `"block"` but does not pause — this must be enforced in `session/prompt.ts`.

### Reflection Behavior

`Reflector.run()` (existing code) condenses observations when observation tokens exceed `40_000`. Result stored in `reflections` field of `ObservationTable`. No changes needed here.

### Replay Boundary Rules

The `last_observed_at` field in `ObservationRecord` marks the observation replay boundary. Messages at or before this timestamp are not re-injected verbatim — only their compressed observation representation is used.

**Rule**: a message is "observed" only when its content is included in an observation record where `last_observed_at >= message.time_created`.

### CurrentTask and SuggestedContinuation

Stored in `ObservationRecord.current_task` and `ObservationRecord.suggested_continuation`. Populated by the observer LLM when it detects task/continuation context. Injected via `SystemPrompt.observations()`.

### LastObservedAt / Cursor Metadata

`ObservationRecord.last_observed_at` is a Unix timestamp (integer ms). It serves as the cursor for determining which messages to include in the next context window vs. which are already in observations.

---

## Semantic Recall Design

### What Gets Indexed

The following content types are indexed in `memory_artifacts`:

| Content Type                                     | When Indexed                        | Scope             |
| ------------------------------------------------ | ----------------------------------- | ----------------- |
| Observation records (on activation)              | After each successful OM activation | `thread`          |
| Working memory snapshots (on significant update) | When WM changes significantly       | `project`, `user` |
| Agent handoff notes                              | On handoff write                    | `agent`           |
| AutoDream consolidation output                   | After successful AutoDream run      | `project`         |
| User-saved patterns                              | On explicit save                    | `global_pattern`  |

### Scopes That Can Be Searched

All five scopes can be searched. Default priority:

```
thread → agent → project → user → global_pattern
```

The `searchArtifacts()` method accepts a list of `ScopeRef[]` to restrict search to specific scopes.

### Retrieval Result Composition

Results from `SemanticRecall.search()` are formatted as a block:

```
<semantic-recall>
[1] {title} ({scope_type}/{scope_id})
{content truncated to 300 chars}

[2] ...
</semantic-recall>
```

The total result block respects the `semanticRecallBudget` token cap (default: 2000 tokens).

### Context Range Handling

Each artifact stores `scope_type` and `scope_id`. When composing context, artifacts from more specific scopes are prioritized. The token budget is consumed in priority order.

### Embeddings / Vector Abstraction

V1 uses FTS5. The abstraction is:

```typescript
// semantic-recall.ts

interface RecallBackend {
  index(artifact: MemoryArtifact): Promise<void>
  search(query: string, scopes: ScopeRef[], limit: number): Promise<MemoryArtifact[]>
}

class FTSBackend implements RecallBackend {
  // Uses memory_artifacts_fts FTS5 virtual table
}

// Future:
class VectorBackend implements RecallBackend {
  // Uses vector embeddings for similarity search
}
```

The `SemanticRecallService` accepts a `RecallBackend` (defaults to `FTSBackend`). This makes it possible to swap in a vector backend without changing the `MemoryProvider` interface.

### Topic Key Support

`memory_artifacts` has a `topic_key` field. When indexing:

1. If `topic_key` is provided and a record with the same `(topic_key, scope_type, scope_id)` exists: UPDATE (revision-aware), increment `revision_count`, update FTS index.
2. If no matching topic key: dedupe by `normalized_hash` within a 15-minute window.
3. Otherwise: INSERT new artifact.

This is Engram's best pattern, internalized.

---

## Fork and Handoff Design

### The Problem (Current State)

Currently, when a session forks (parent → child), the fork context is stored in a transient in-memory `Map`. This map is lost on process restart. The child session has no way to recover its parent context after a restart.

### Durable Fork Context

Before the fork is considered live, the fork context is written to `memory_fork_contexts`:

```typescript
// handoff.ts

export namespace Handoff {
  export function writeFork(ctx: { sessionId: string; parentSessionId: string; context: string }): void {
    Database.transaction(() => {
      Database.use((db) =>
        db
          .insert(ForkContextTable)
          .values({
            id: Identifier.ascending("fork"),
            session_id: ctx.sessionId,
            parent_session_id: ctx.parentSessionId,
            context: ctx.context,
            time_created: Date.now(),
          })
          .onConflictDoUpdate({
            target: ForkContextTable.session_id,
            set: { context: ctx.context, time_created: Date.now() },
          })
          .run(),
      )
    })
    // The fork is only considered live AFTER this write succeeds
  }

  export function getFork(sessionId: string): ForkContext | undefined {
    return Database.use((db) =>
      db.select().from(ForkContextTable).where(eq(ForkContextTable.session_id, sessionId)).get(),
    )
  }
}
```

### Agent Handoff

When a parent agent spawns a child subagent, it writes an `AgentHandoff` record that includes:

1. Parent context snapshot (relevant recent messages + observations)
2. Working memory snapshot (project-scope WM at fork time)
3. Observation snapshot (OM text at fork time)
4. Metadata (agent ID, task description, constraints)

The child session reads this handoff on startup:

```typescript
// In session initialization:
const handoff = await Memory.getHandoff(sessionId)
if (handoff) {
  // Inject handoff context into first system message
  // Initialize child's working memory from snapshot
}
```

### Memory Continuity Across Restarts

On session resume after process restart:

1. `Memory.getForkContext(sessionId)` → returns durable fork context
2. `Memory.getObservations(sessionId)` → returns last OM record (persisted in DB already)
3. `Memory.getWorkingMemory({ type: 'project', id: projectPath })` → returns project WM

This replaces the transient in-memory fork map for core continuity.

### No Reliance on Transient-Only Maps

The in-memory fork map in the current codebase is retained for performance (fast lookup during live process), but the DB is the source of truth. On every fork write, the DB is updated. On read, the in-memory map is checked first, then the DB on miss.

---

## Runtime Integration Design

### MemoryProvider in the Runtime

The `session/prompt.ts` run loop uses `MemoryProvider.buildContext()` to assemble memory context before each LLM call:

```typescript
// In session/prompt.ts — context assembly

const memCtx = await Memory.buildContext({
  scope: { type: "thread", id: session.id },
  ancestorScopes: [
    { type: "project", id: project.path },
    { type: "user", id: "default" },
  ],
  recentHistoryLimit: 50,
  workingMemoryBudget: 2000,
  observationsBudget: 4000,
  semanticRecallBudget: 2000,
  semanticQuery: lastUserMessage,
})

// Then build system prompt parts:
const systemParts = [
  SystemPrompt.provider(model),
  await SystemPrompt.environment(model),
  memCtx.semanticRecall && wrapRecall(memCtx.semanticRecall),
  memCtx.workingMemory && wrapWorkingMemory(memCtx.workingMemory),
  memCtx.observations && wrapObservations(memCtx.observations, memCtx.continuationHint),
  ...
].filter(Boolean)
```

### System Prompt Order

Context assembly order (first → last in system prompt):

1. Provider prompt (static)
2. Environment info (volatile)
3. Semantic recall (prior relevant knowledge)
4. Working memory (current stable state)
5. Observations (compressed narrative)
6. Skills and tools
7. Continuation hint (as final synthetic user message before recent history)

This order mirrors Mastra's documented best practice: background → stable state → recent narrative → continuation.

### No External Process Dependency

`Memory.buildContext()` reads directly from SQLite. No MCP, no HTTP, no daemon required.

### Internal Interfaces, Not Direct DB Access

The `session/prompt.ts` and `session/system.ts` files MUST NOT import from `storage/db.ts` directly for memory operations. All memory DB access goes through `memory/provider.ts`.

### AutoDream Integration

`dream/index.ts` is refactored to:

1. Call `Memory.buildContext()` to read the current OM state (instead of calling Engram MCP directly)
2. After the dream LLM session completes, write consolidated artifacts to `memory/provider.ts` via `Memory.indexArtifact()` (instead of calling Engram `mem_save` / `mem_update`)
3. Feature flag: `OPENCODE_DREAM_USE_NATIVE_MEMORY` (default: `true`) — allows rollback to Engram MCP path

---

## Migration Design

### What Old Behavior Is Replaced

| Location                   | Old Behavior                                  | New Behavior                   |
| -------------------------- | --------------------------------------------- | ------------------------------ |
| `session/system.ts:87-110` | Calls Engram MCP `mem_context` + `mem_search` | Calls `Memory.buildContext()`  |
| `dream/index.ts:182-207`   | Calls Engram MCP `mem_save` / `mem_update`    | Calls `Memory.indexArtifact()` |
| `dream/engram.ts`          | Engram daemon ensure + health check           | Deprecated (see SUPERSEDED.md) |
| `dream/ensure.ts`          | Ensures Engram daemon is running              | Deprecated                     |
| Fork continuity            | In-memory map only                            | DB-backed + in-memory cache    |

### What Can Be Migrated

- Existing `session_observation` records: already in LightCode DB — no migration needed, these are read by the new `MemoryProvider` via the existing `OM.get()` API.
- Existing Engram observations: these live in `~/.engram/engram.db`. A one-time import helper (`memory/import.ts`) can be added in a future phase to copy Engram observations into `memory_artifacts` for projects that have existing Engram data.

### What Is Intentionally Reset

- `autodream.json` state file — the last consolidation timestamp is reset; AutoDream will re-consolidate from the current OM record on next idle.
- Engram cloud sync state — out of scope for native memory core.
- The Engram binary itself is not removed from the system; it is just no longer required by LightCode.

### How to Avoid Silent Data Loss

1. All migrations are `CREATE TABLE IF NOT EXISTS` — additive only.
2. No `ALTER TABLE DROP COLUMN` or `DROP TABLE` operations.
3. The deprecation of `dream/engram.ts` is behind a feature flag.
4. A `docs/SUPERSEDED.md` document lists all deprecated files with rationale.
5. Old Engram data is not touched — it stays in `~/.engram/engram.db` untouched.

### Drizzle Migration Files

New migration file to be created in `packages/opencode/migration/`:

```
migration/
  ...existing...
  20260405000000_memory_core_v1/
    migration.sql
```

This migration creates all five new tables:

- `memory_working`
- `memory_artifacts`
- `memory_agent_handoffs`
- `memory_fork_contexts`
- `memory_links`

Plus FTS virtual table and triggers for `memory_artifacts_fts`.

---

## Context Assembly Design

### Token Budget Model

Default token budgets for `buildContext()`:

| Layer           | Default Budget                   | Priority |
| --------------- | -------------------------------- | -------- |
| Recent History  | Unlimited (controlled by caller) | Highest  |
| Working Memory  | 2,000 tokens                     | High     |
| Observations    | 4,000 tokens                     | Medium   |
| Semantic Recall | 2,000 tokens                     | Low      |
| Total cap       | 8,000 tokens (all memory layers) | —        |

If the total exceeds cap:

1. Trim semantic recall first
2. Trim observations (use reflections if available, else observations[:budget])
3. Trim working memory (use most recently updated keys first)

### Assembly Algorithm

```typescript
async function buildContext(opts: ContextBuildOptions): Promise<MemoryContext> {
  // Step 1: Load all layers in parallel
  const [wm, omRec, artifacts] = await Promise.all([
    WorkingMemory.getForScopes(opts.scope, opts.ancestorScopes ?? []),
    // Get OM record from existing OM system
    opts.scope.type === "thread" ? OM.get(opts.scope.id as SessionID) : undefined,
    opts.semanticQuery
      ? SemanticRecall.search(opts.semanticQuery, [opts.scope, ...(opts.ancestorScopes ?? [])], 10)
      : [],
  ])

  // Step 2: Format each layer with token caps
  const observations = omRec ? formatObservations(omRec, opts.observationsBudget ?? 4000) : undefined
  const workingMemory = wm.length ? formatWorkingMemory(wm, opts.workingMemoryBudget ?? 2000) : undefined
  const semanticRecall = artifacts.length ? formatArtifacts(artifacts, opts.semanticRecallBudget ?? 2000) : undefined

  // Step 3: Count tokens
  const totalTokens = [observations, workingMemory, semanticRecall]
    .filter(Boolean)
    .reduce((sum, s) => sum + Token.estimate(s!), 0)

  return {
    recentHistory: undefined, // caller handles this
    workingMemory,
    observations,
    semanticRecall,
    continuationHint: omRec?.suggested_continuation ?? undefined,
    totalTokens,
  }
}
```

### Prompt Wrapper Templates

```typescript
function wrapWorkingMemory(body: string, scope: MemoryScope): string {
  return `<working-memory scope="${scope}">\n${body}\n</working-memory>`
}

function wrapSemanticRecall(body: string): string {
  return `<memory-recall>\n${body}\n</memory-recall>`
}

// wrapObservations already exists in session/system.ts — preserved
```
