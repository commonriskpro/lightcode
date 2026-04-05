# LightCode Memory Core V1 — Implementation Tasks

**Status**: Active  
**Phase**: Tasks (Phase 3 of 6)  
**Date**: 2026-04-05  
**Depends On**: `LIGHTCODE_MEMORY_CORE_V1_DESIGN.md`

---

## Task Map

```
T1 (Foundation)
  ↓
T2 (Schema + Migration)
  ↓
T3 (Contracts)
  ↓
T4 (Working Memory Service)  T5 (Semantic Recall Service)  T6 (Handoff Service)
         ↓                              ↓                          ↓
                         T7 (MemoryProvider)
                                 ↓
                T8 (OM Durability Guards)
                                 ↓
                T9 (Runtime Integration)
                                 ↓
                T10 (AutoDream Refactor)
                                 ↓
                T11 (Superseded Doc)
                                 ↓
                T12 (Tests)
```

T4, T5, T6 can run in parallel after T3 completes.

---

## T1 — Foundation: Create `memory/` Module

**Goal**: Create the `packages/opencode/src/memory/` directory with a barrel export.

**Files**:

- `packages/opencode/src/memory/index.ts` — barrel

**Dependencies**: None

**Acceptance Criteria**:

- `memory/index.ts` exports exist (can be empty for now)
- No circular dependency introduced

**Tests Required**: None (structural only)

---

## T2 — Schema + Migration

**Goal**: Add all new memory tables to the database via an additive Drizzle migration.

**Files**:

- `packages/opencode/src/memory/schema.sql.ts` — Drizzle table definitions
- `packages/opencode/migration/20260405000000_memory_core_v1/migration.sql` — SQL migration

**Dependencies**: T1

**Tables to create**:

- `memory_working` with unique index on `(scope_type, scope_id, key)`
- `memory_artifacts` with indexes + FTS5 virtual table + sync triggers
- `memory_agent_handoffs` with indexes
- `memory_fork_contexts` with indexes
- `memory_links` with indexes

**Acceptance Criteria**:

- Migration runs on a fresh DB without error
- Migration is idempotent (`IF NOT EXISTS` everywhere)
- `bun run db` (drizzle-kit) shows new tables
- No existing tables modified

**Tests Required**:

- `T2.test.ts`: open fresh in-memory DB, run migrations, verify all 5 tables exist

---

## T3 — Contracts

**Goal**: Define all internal TypeScript types and the `MemoryProvider` interface. No DB code in this file.

**Files**:

- `packages/opencode/src/memory/contracts.ts`

**Dependencies**: T1

**Types to define**:

- `MemoryScope` — union type
- `ScopeRef` — `{ type: MemoryScope; id: string }`
- `MemoryContext` — composed context result
- `ContextBuildOptions` — options for `buildContext()`
- `WorkingMemoryRecord` — mirrors `memory_working` row
- `MemoryArtifact` — mirrors `memory_artifacts` row
- `AgentHandoff` — mirrors `memory_agent_handoffs` row
- `ForkContext` — mirrors `memory_fork_contexts` row
- `MemoryLink` — mirrors `memory_links` row
- `MemoryProvider` — interface (not implementation)
- `RecallBackend` — interface for FTS/vector backends

**Acceptance Criteria**:

- All types match schema defined in T2
- TypeScript strict mode: no `any`
- Exports are clean (no DB imports)

**Tests Required**: None (type-only file)

---

## T4 — Working Memory Service

**Goal**: Implement `WorkingMemoryService` with full CRUD and scope-aware retrieval.

**Files**:

- `packages/opencode/src/memory/working-memory.ts`

**Dependencies**: T2, T3

**Operations to implement**:

```typescript
export namespace WorkingMemory {
  // Get all working memory records for a scope
  function get(scope: ScopeRef, key?: string): WorkingMemoryRecord[]

  // Get working memory for a chain of scopes (thread → agent → project → user → global)
  function getForScopes(primary: ScopeRef, ancestors: ScopeRef[]): WorkingMemoryRecord[]

  // Upsert a key in a scope
  function set(scope: ScopeRef, key: string, value: string, format?: "markdown" | "json"): void

  // Delete a key from a scope
  function remove(scope: ScopeRef, key: string): void

  // Format records for prompt injection
  function format(records: WorkingMemoryRecord[], budget: number): string | undefined
}
```

**Scope validation**: reject writes to `global_pattern` scope if content contains `<private>` tags.

**Acceptance Criteria**:

- `set()` creates new record when key doesn't exist
- `set()` updates existing record and increments `version` when key exists
- `get()` returns records filtered by scope
- `getForScopes()` returns records for all scopes in order
- `format()` respects token budget
- Private tag stripping on `global_pattern` writes
- All operations run inside `Database.use()` / `Database.transaction()`

**Tests Required**:

- Write + read round-trip per scope
- Update increments version
- Scope isolation: writes to project don't appear in user scope
- Persist after DB close + reopen (using temp file DB)
- Format respects token budget

---

## T5 — Semantic Recall Service

**Goal**: Implement `SemanticRecallService` with FTS5-backed search and topic-key dedupe.

**Files**:

- `packages/opencode/src/memory/semantic-recall.ts`

**Dependencies**: T2, T3

**Operations to implement**:

```typescript
export namespace SemanticRecall {
  // Index a memory artifact (with topic-key dedupe + hash dedupe)
  function index(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): string

  // Search across scopes
  function search(query: string, scopes: ScopeRef[], limit?: number): MemoryArtifact[]

  // Get a specific artifact by ID
  function get(id: string): MemoryArtifact | undefined

  // Soft-delete an artifact
  function remove(id: string): void

  // Format results for prompt injection
  function format(artifacts: MemoryArtifact[], budget: number): string | undefined
}
```

**Topic-key dedupe logic** (from Engram patterns):

1. If `topic_key` provided: find latest matching `(topic_key, scope_type, scope_id)` → UPDATE, increment `revision_count`
2. Else: find matching `normalized_hash` within 15-minute dedupe window → UPDATE `duplicate_count`
3. Else: INSERT new artifact

**Hash normalization**: strip whitespace, lowercase, SHA-256 of normalized content.

**FTS5 query sanitization**: wrap each search term in double quotes to avoid FTS5 syntax errors.

**Acceptance Criteria**:

- `index()` with same topic_key → single record with incremented `revision_count`
- `search()` returns results filtered by scope
- `search()` FTS5 special char query doesn't crash
- `format()` respects token budget
- Soft delete sets `deleted_at`, excludes from search
- Deleted artifacts don't appear in search results

**Tests Required**:

- Topic-key dedupe (same key → revision_count increments)
- Hash dedupe within window
- Hash dedupe outside window → new record
- Scope-filtered search
- Special char in query doesn't crash
- Soft delete excludes from results

---

## T6 — Handoff Service

**Goal**: Implement durable fork context and agent handoff persistence.

**Files**:

- `packages/opencode/src/memory/handoff.ts`

**Dependencies**: T2, T3

**Operations to implement**:

```typescript
export namespace Handoff {
  // Write fork context (blocking, transactional)
  function writeFork(ctx: { sessionId: string; parentSessionId: string; context: string }): void

  // Read fork context
  function getFork(sessionId: string): ForkContext | undefined

  // Write agent handoff (parent → child, blocking, transactional)
  function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): string

  // Read agent handoff
  function getHandoff(childSessionId: string): AgentHandoff | undefined
}
```

**Critical**: `writeFork()` and `writeHandoff()` use `Database.transaction()`. The fork/handoff is only considered live AFTER the DB write succeeds.

**Acceptance Criteria**:

- Fork context survives DB close + reopen
- Agent handoff persists parent context snapshot
- `getFork()` returns `undefined` for session with no fork
- `getHandoff()` returns `undefined` for session with no handoff
- Duplicate fork write (same sessionId) does upsert, not error

**Tests Required**:

- Write fork → close DB → reopen → read fork (durability)
- Write handoff with WM snapshot → read back full handoff
- No fork for session → returns undefined
- Duplicate fork write → upsert (no error)

---

## T7 — MemoryProvider

**Goal**: Implement the `MemoryProvider` that composes all four memory layers.

**Files**:

- `packages/opencode/src/memory/provider.ts`
- `packages/opencode/src/memory/index.ts` (update exports)

**Dependencies**: T3, T4, T5, T6 (and existing `session/om/record.ts` for OM access)

**Main operation**:

```typescript
export namespace Memory {
  async function buildContext(opts: ContextBuildOptions): Promise<MemoryContext>
  function getWorkingMemory(scope: ScopeRef, key?: string): WorkingMemoryRecord[]
  function setWorkingMemory(scope: ScopeRef, key: string, value: string, format?: "markdown" | "json"): void
  function getObservations(sessionId: string): ObservationRecord | undefined // delegates to OM.get
  async function searchArtifacts(query: string, scopes: ScopeRef[], limit?: number): Promise<MemoryArtifact[]>
  function indexArtifact(artifact: Omit<MemoryArtifact, "id" | "time_created" | "time_updated">): string
  function getHandoff(childSessionId: string): AgentHandoff | undefined
  function writeHandoff(h: Omit<AgentHandoff, "id" | "time_created">): string
  function getForkContext(sessionId: string): ForkContext | undefined
  function writeForkContext(ctx: Omit<ForkContext, "id" | "time_created">): void
}
```

**Context assembly order** (per design):

1. Load WM, OM record, semantic recall artifacts in parallel
2. Format each with token budget
3. Return `MemoryContext`

**Acceptance Criteria**:

- `buildContext()` returns all four layers populated when data exists
- Empty layers return `undefined` (not empty string)
- Token budgets respected per layer
- No external process calls
- Works when DB has no memory data yet (returns all `undefined`)

**Tests Required**:

- `buildContext()` returns all undefined when DB is empty
- `buildContext()` returns working memory when WM record exists
- `buildContext()` returns observations when OM record exists
- `buildContext()` returns semantic recall when artifacts exist
- Token budget caps each layer independently

---

## T8 — OM Durability Guards

**Goal**: Wrap the existing OM persistence in durability guards so observation is not marked as observed until DB write succeeds.

**Files**:

- `packages/opencode/src/session/om/record.ts` — add `observeSafe()` wrapper
- `packages/opencode/src/session/prompt.ts` — use `observeSafe()` instead of direct `OM.upsert()`

**Dependencies**: T7

**Change**:

```typescript
// In record.ts — add:
export function observeSafe(sid: SessionID, rec: ObservationRecord, sealAt: number): void {
  Database.transaction(() => {
    Database.use((db) =>
      db.insert(ObservationTable).values(rec).onConflictDoUpdate({ target: ObservationTable.id, set: rec }).run(),
    )
    OMBuf.seal(sid, sealAt)
  })
}
```

**In prompt.ts**: replace the two-step `OM.upsert()` + `OMBuf.seal()` with a single `observeSafe()` call.

**Acceptance Criteria**:

- If DB write throws, seal does NOT advance
- If DB write succeeds, seal advances atomically
- Existing OM behavior unchanged when DB is healthy

**Tests Required**:

- Mock DB failure in observation write → verify seal does not advance
- Healthy DB write → verify seal advances with observation

---

## T9 — Runtime Integration

**Goal**: Replace the Engram MCP recall in `system.ts` and add `Memory.buildContext()` call in `prompt.ts`.

**Files**:

- `packages/opencode/src/session/system.ts` — replace `recall()` implementation
- `packages/opencode/src/session/prompt.ts` — add `Memory.buildContext()` call

**Dependencies**: T7, T8

### Changes to `system.ts`

Replace:

```typescript
// OLD: calls Engram MCP
export async function recall(pid: string): Promise<string | undefined>
```

With:

```typescript
// NEW: reads from native MemoryProvider
export async function recall(pid: string, sessionId?: string): Promise<string | undefined> {
  try {
    const scopes: ScopeRef[] = [
      { type: "project", id: pid },
      { type: "user", id: "default" },
    ]
    if (sessionId) scopes.unshift({ type: "thread", id: sessionId })

    const artifacts = await Memory.searchArtifacts(pid, scopes, 20)
    if (!artifacts.length) return undefined

    const body = SemanticRecall.format(artifacts, 2000)
    if (!body) return undefined
    return wrapRecall(body)
  } catch {
    return undefined
  }
}
```

**Note**: Keep `wrapRecall()` helper for backward compatibility.

### Changes to `prompt.ts`

Add `Memory.buildContext()` call before system prompt assembly to inject working memory. Observational memory is already handled by existing `SystemPrompt.observations()`.

**Acceptance Criteria**:

- `system.ts:recall()` reads from `memory_artifacts` not Engram MCP
- Working memory from project scope is injected into system prompt when present
- No MCP call in the hot path
- Falls back gracefully if memory DB has no data

**Tests Required**:

- `recall()` returns results from native memory artifacts
- `recall()` returns undefined when no artifacts indexed
- Working memory injection: project WM appears in system prompt parts

---

## T10 — AutoDream Refactor

**Goal**: Refactor `dream/index.ts` to write consolidated memory to native `MemoryProvider` instead of Engram MCP, with a feature flag for rollback.

**Files**:

- `packages/opencode/src/dream/index.ts` — refactor consolidation writes
- `packages/opencode/src/flag/flag.ts` — add `OPENCODE_DREAM_USE_NATIVE_MEMORY` flag
- `packages/opencode/src/dream/engram.ts` — mark deprecated

**Dependencies**: T9

**Changes**:

1. Add feature flag: `Flag.OPENCODE_DREAM_USE_NATIVE_MEMORY` (default: `true`)
2. In the dream agent completion handler:
   - OLD path (flag=false): call Engram MCP `mem_save` / `mem_update`
   - NEW path (flag=true): call `Memory.indexArtifact()` with scope `{ type: "project", id: projectPath }`
3. When reading context for the dream prompt, use `Memory.getObservations()` instead of `OM.get()` directly (same data, but through the provider interface)

**Acceptance Criteria**:

- With `OPENCODE_DREAM_USE_NATIVE_MEMORY=true`: dream consolidation writes to `memory_artifacts`
- With `OPENCODE_DREAM_USE_NATIVE_MEMORY=false`: old Engram MCP path still works
- Dream agent still reads local OM from `OM.get()` (unchanged)
- No silent failures: if native write fails, log error and fall back to flag=false path

**Tests Required**:

- Dream consolidation with native flag writes artifact to `memory_artifacts`
- Artifact appears in subsequent `SemanticRecall.search()` results

---

## T11 — Superseded Documentation

**Goal**: Document all deprecated/superseded files so nothing is silently dead code.

**Files**:

- `docs/SUPERSEDED.md` — new file listing what was replaced and why

**Dependencies**: T10

**Content**:

- `dream/engram.ts` — deprecated, Engram daemon integration
- `dream/ensure.ts` — deprecated, daemon health check
- `session/system.ts:recall()` (old implementation) — replaced by native `Memory.searchArtifacts()`
- AutoDream + Engram MCP path — replaced by `Memory.indexArtifact()` (behind flag)

**Acceptance Criteria**:

- File exists and is accurate
- Each deprecated component links to its replacement

**Tests Required**: None (documentation)

---

## T12 — Tests

**Goal**: Write focused tests for all memory systems per validation expectations.

**Files**:

- `packages/opencode/src/memory/working-memory.test.ts`
- `packages/opencode/src/memory/semantic-recall.test.ts`
- `packages/opencode/src/memory/handoff.test.ts`
- `packages/opencode/src/memory/provider.test.ts`
- `packages/opencode/src/session/om/durability.test.ts`

**Dependencies**: T8, T9, T10

**Test list** (per spec SC criteria):

- SC-1: `buildContext()` returns all layers
- SC-2: Working memory persists after restart
- SC-3: Observation not marked observed if DB write fails
- SC-4: Fork context recoverable after restart
- SC-5: FTS5 search returns relevant results
- SC-6: Scoped retrieval doesn't bleed across scopes
- SC-7: Topic-key dedupe updates, not inserts
- SC-8: Semantic recall index is queryable
- SC-9: No external process required for memory operations
- SC-10: Fresh DB migration runs without error

**Acceptance Criteria**:

- All 10 SC tests pass
- No test requires an external Engram daemon
- Tests run in isolation (in-memory or temp file DB)
- `bun test packages/opencode/src/memory/` exits 0

---

## Task Execution Order

| Wave   | Tasks      | Can Parallelize?            |
| ------ | ---------- | --------------------------- |
| Wave 1 | T1, T2, T3 | T1 and T2 + T3 after T1     |
| Wave 2 | T4, T5, T6 | All three in parallel       |
| Wave 3 | T7         | After T4, T5, T6 complete   |
| Wave 4 | T8         | After T7                    |
| Wave 5 | T9         | After T8                    |
| Wave 6 | T10, T11   | T10 after T9; T11 after T10 |
| Wave 7 | T12        | After T10, T11              |

## Estimated Complexity

| Task | Complexity | Key Risk                                           |
| ---- | ---------- | -------------------------------------------------- |
| T1   | Trivial    | None                                               |
| T2   | Low        | FTS5 trigger syntax must be exact                  |
| T3   | Low        | Type accuracy vs schema                            |
| T4   | Medium     | Scope inheritance logic                            |
| T5   | Medium     | Topic-key dedupe + FTS sanitization                |
| T6   | Low        | Transactional guarantee                            |
| T7   | Medium     | Parallel load + token budget                       |
| T8   | Low        | Test transactional atomicity                       |
| T9   | Medium     | Backward compatibility with existing system prompt |
| T10  | Medium     | Feature flag + fallback path                       |
| T11  | Trivial    | Documentation accuracy                             |
| T12  | High       | Test isolation (in-memory DB)                      |
