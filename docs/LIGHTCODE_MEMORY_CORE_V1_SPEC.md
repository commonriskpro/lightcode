# LightCode Memory Core V1 — Specification

**Status**: Active  
**Phase**: Spec (Phase 1 of 6)  
**Date**: 2026-04-05  
**Author**: SDD Initiative Run

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Why the Current Architecture Is Insufficient](#why-the-current-architecture-is-insufficient)
4. [Product Goals](#product-goals)
5. [Technical Goals](#technical-goals)
6. [Success Criteria](#success-criteria)
7. [Non-Goals](#non-goals)
8. [Constraints](#constraints)
9. [Memory Layers](#memory-layers)
10. [Scope Model](#scope-model)
11. [Migration Expectations](#migration-expectations)
12. [Validation Expectations](#validation-expectations)
13. [Rollout Expectations](#rollout-expectations)
14. [Risks](#risks)

---

## Overview

LightCode Memory Core V1 is the canonical, native in-process memory architecture for LightCode. It replaces the current fragmented memory system — which depends on an external Engram Go binary accessed via MCP — with a single, cohesive TypeScript memory layer embedded directly inside the LightCode runtime.

Memory is **composed, not monolithic**. The architecture draws from two proven systems:

- **Engram** (Gentleman-Programming): SQLite + FTS5 storage model, WAL pragmas, topic keys, dedupe by normalized hash, revision tracking, soft delete, timeline retrieval, scope-aware observations, compact context generation.
- **Mastra** (`@mastra/memory`): Composed memory layers (recent history, working memory, observational memory, semantic recall), explicit scopes (thread/resource/global), observer + reflector pipeline, async observation buffering, activation thresholds, blockAfter safety, continuation metadata.

This specification defines LightCode Memory Core V1 as the foundational product initiative to:

1. Move all memory persistence into one native SQLite database.
2. Replace the Engram MCP dependency with an internal `MemoryProvider` abstraction.
3. Implement all four canonical memory layers explicitly and separately.
4. Implement the five canonical memory scopes.
5. Deliver durable fork/handoff continuity.
6. Enable semantic recall as a first-class capability.

---

## Problem Statement

LightCode currently has a **split memory architecture** with at least three independent systems that do not compose cleanly:

### System 1 — Engram MCP (Cross-Session Recall)

- Located: `packages/opencode/src/session/system.ts:87-110`
- Calls `mem_context` and `mem_search` on an **external Go binary** via the MCP protocol over HTTP.
- Failure mode: the Engram daemon may not be running, network errors silently return `undefined`, and the recall is silently dropped.
- No type safety — the tool is discovered by name substring matching and executed as a black box.
- 2000-token cap applied by char-division heuristic, not real tokenization.
- AutoDream consolidation also calls Engram via MCP as a side-effect of a dream agent session.

### System 2 — Intra-Session Observational Memory (OM)

- Located: `packages/opencode/src/session/om/`
- Token-threshold state machine triggers LLM-driven background extraction.
- Observations are stored in `ObservationTable` per session in the LightCode SQLite DB.
- Reflector condenses observations when they exceed 40k token threshold.
- **Scope is session-only** — no cross-session, cross-agent, or cross-project OM.
- **No working memory** — facts, preferences, and goals are not tracked separately from narrative observations.
- Buffers exist (`ObservationBufferTable`) but `addBuffer` and `activate` are not called from the main loop — they are dead code paths.

### System 3 — AutoDream (Async Consolidation)

- Located: `packages/opencode/src/dream/`
- On session idle, spawns a hidden LLM dream agent that reads local OM and calls Engram MCP tools to persist cross-session memory.
- **Fragile**: depends on the Engram daemon being alive; consolidation is LLM-directed, not deterministic.
- No memory of what was or wasn't already consolidated — can re-consolidate same observations.
- Dream prompt itself is ~500 tokens of fragile instruction.

### System 4 — Fork Maps (Subagent Continuity)

- In-memory only: when a session forks, the child session receives parent context from a transient in-memory map.
- **Survives only for the lifetime of the process** — a restart breaks all fork continuity.
- No durable persistence of fork context.

### What's Missing

| Capability                                              | Current State                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| Working memory (stable facts/state)                     | Not implemented                                                  |
| Cross-scope semantic recall                             | External MCP only                                                |
| Durable fork/handoff context                            | Transient in-memory only                                         |
| Native observational memory (no external dep)           | Partial (intra-session OM exists but cross-session is Engram)    |
| Explicit scope model (thread/agent/project/user/global) | Not implemented                                                  |
| One SQLite DB for all memory                            | No — OM is in LightCode DB, cross-session memory is in Engram DB |

---

## Why the Current Architecture Is Insufficient

### 1. External Process Dependency

The core memory layer depends on an external Go binary (`engram`). If it is not running, cross-session recall silently returns nothing. This is a silent degradation with no recovery path, no queue, and no persistence guarantee.

### 2. Scope Blindness

The current system has no explicit scope model. OM observations are session-scoped only. The Engram data is project-scoped by convention but there is no agent-scope, user-scope, or global-pattern-scope. The runtime cannot ask "what does this agent remember about this project?"

### 3. No Working Memory

Working memory — stable, durable, structured facts about a project, user preferences, active goals, and constraints — does not exist as a first-class system. Instead, everything is either in the raw message history or in observational narrative text that is not structured for stable fact recall.

### 4. Fragile Fork Continuity

Subagent fork continuity is purely in-memory. A process restart destroys all fork context. This makes multi-agent workflows unreliable across any interruption.

### 5. No Semantic Recall

There is no semantic similarity search within LightCode's own data. The `mem_search` Engram tool uses FTS5 (keyword-based). True semantic recall (embedding-based similarity) does not exist natively.

### 6. Memory Is Not Composed

The four memory systems are effectively independent. There is no unified `MemoryProvider` that composes recent history + working memory + observational memory + semantic recall into a single context assembly. The system prompt is assembled ad-hoc from these separate systems without a coherent ordering or budget model.

---

## Product Goals

1. **PG-1**: LightCode has one canonical memory architecture — native TypeScript, no external binary dependency.
2. **PG-2**: All memory persistence goes to one SQLite database (`lightcode.db`).
3. **PG-3**: Memory is composed from four explicit layers: recent history, working memory, observational memory, semantic recall.
4. **PG-4**: Memory is scope-aware: thread, agent, project, user, global_pattern.
5. **PG-5**: Fork and subagent handoff context is durable — survives process restart.
6. **PG-6**: Working memory is a first-class, durable, prompt-injectable system.
7. **PG-7**: Semantic recall is a first-class capability backed by a retrievable index.
8. **PG-8**: The system is extensible — vector/embedding backends can evolve without breaking the contract.
9. **PG-9**: The architecture enables durable cross-session and cross-agent memory for the same project.
10. **PG-10**: The architecture enables user-wide and global-pattern memory as explicit scopes.

---

## Technical Goals

1. **TG-1**: Define a `MemoryProvider` internal interface that the runtime talks to. No scattered direct DB access for memory.
2. **TG-2**: One SQLite DB path, managed by Drizzle ORM, with explicit schema migrations.
3. **TG-3**: FTS5-backed search for observational memory and working memory.
4. **TG-4**: All four memory layers compose into a single `buildContext()` method with defined ordering.
5. **TG-5**: No MCP dependency in the memory core path.
6. **TG-6**: Observation durability: do not mark anything as observed before durable persistence succeeds.
7. **TG-7**: Working memory is separate from observational memory — different schema, different update model, different prompt injection.
8. **TG-8**: Semantic recall uses a clean abstraction that supports both FTS5 fallback and future vector backends.
9. **TG-9**: Fork context is written to DB before the fork is considered live.
10. **TG-10**: All memory modules are importable independently — no circular dependencies through `session/`.

---

## Success Criteria

| ID    | Criterion                                                                  | Measurable                                                        |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| SC-1  | `MemoryProvider.buildContext()` returns composed context from all 4 layers | Test: context contains all layer sections                         |
| SC-2  | Working memory is persisted and survives process restart                   | Test: read after DB close/reopen                                  |
| SC-3  | Observation is only marked as observed after DB write succeeds             | Test: DB failure leaves observation in pending state              |
| SC-4  | Fork context is recoverable after process restart                          | Test: write fork, restart DB, read fork                           |
| SC-5  | FTS5 search returns relevant observations                                  | Test: keyword search returns matching records                     |
| SC-6  | Scoped retrieval returns only matching scope records                       | Test: project-scope search doesn't bleed into user-scope          |
| SC-7  | Topic-key dedupe updates existing observation, not insert new              | Test: same topic_key → revision_count increments                  |
| SC-8  | Semantic recall index is queryable                                         | Test: index a memory artifact, retrieve it                        |
| SC-9  | No external process required for any memory operation                      | Integration test: memory operations succeed with no Engram daemon |
| SC-10 | All migration files apply cleanly on a fresh DB                            | Test: fresh DB migration runs without error                       |

---

## Non-Goals

- **NG-1**: This initiative does NOT remove the Engram MCP server from the product — Engram remains available as a community tool. We internalize the storage/retrieval patterns, not copy-paste the code.
- **NG-2**: This initiative does NOT replace vector databases or add a full embedding pipeline in V1. Semantic recall V1 uses FTS5 with a clean extension interface for future embedding backends.
- **NG-3**: This initiative does NOT rewrite the observational memory observer/reflector LLM prompts. Those are separate product decisions.
- **NG-4**: This initiative does NOT redesign the AutoDream consolidation agent logic. AutoDream is refactored to write to the native memory core rather than Engram MCP, but the agent logic is preserved.
- **NG-5**: This initiative does NOT redesign the session/prompt pipeline at large — it targets the memory layer specifically.
- **NG-6**: This initiative does NOT add multi-user or remote sync. That is a separate product milestone.
- **NG-7**: This initiative does NOT add entity graphs or knowledge graph layers. Topic-key upserts are sufficient for V1 structured recall.

---

## Constraints

- **C-1**: Must use Bun SQLite (existing `db.bun.ts` driver). No new DB runtime.
- **C-2**: Must use Drizzle ORM (existing pattern). No raw SQL without Drizzle schema.
- **C-3**: Must coexist with the existing `lightcode.db` file. New tables are additive migrations. No destructive schema changes to existing tables.
- **C-4**: All new code must be TypeScript strict mode. No `any`.
- **C-5**: Module naming must follow project conventions: single-word preferred, camelCase for multi-word.
- **C-6**: No new external npm dependencies for the core memory path. Existing deps (Drizzle, Bun) are sufficient.
- **C-7**: The new memory layer must be usable without an active LLM session. Storage and retrieval must work at any point in the runtime lifecycle.
- **C-8**: Must not break existing OM intra-session logic during migration. The new system wraps and extends existing behavior.

---

## Memory Layers

Memory is composed, not monolithic. The four layers are architecturally distinct, stored in separate tables, and assembled in a defined order.

### Layer 1 — Recent History

**Purpose**: Immediate continuity. Recent messages, recent tool outputs, recent thread context.

**Characteristics**:

- Raw message and part records (already in `MessageTable` / `PartTable`)
- Most recent N messages, configurable per scope
- Not transformed by LLM — verbatim
- Bounded by token budget (last N messages before context window overflow)
- Time-bounded: messages after the OM replay boundary only

**Prompt injection position**: Last in context — most recent messages come right before the response.

**Scope behavior**:

- `thread`: last N messages in this thread
- `agent`: last N messages in this subagent session
- `project`, `user`, `global_pattern`: not applicable (no raw message history at these scopes)

### Layer 2 — Working Memory

**Purpose**: Structured canonical state. Stable facts, preferences, goals, constraints, project decisions. Durable user/project state.

**Characteristics**:

- Stored as key-value or structured markdown/JSON blobs
- Scoped: each (scope_type, scope_id) has its own working memory record
- Versioned: timestamp on every update
- Explicitly separate from observational memory — different update path, different schema
- Prompt-injectable as a structured block

**Prompt injection position**: System prompt — as a stable fact block before observations.

**Scope behavior**:

- `thread`: per-thread working memory (local to one conversation)
- `agent`: per-agent persistent state across that agent's sessions
- `project`: shared facts across all agents and sessions for a project
- `user`: user-wide preferences, identity, constraints
- `global_pattern`: abstract reusable patterns that cross project boundaries

**Update model**:

- Explicit tool: `update_working_memory(scope, key, value)`
- Upsert by key within scope
- Version/timestamp on every write

### Layer 3 — Observational Memory

**Purpose**: Compressed narrative continuity. What happened, what was tried, what was discovered, what changed, what remains. Current task. Suggested continuation.

**Characteristics**:

- LLM-generated observations from message history via observer agent
- Stored per session/thread (current scope: `thread`)
- Buffered: pre-compute observations before they're needed
- Activation threshold: fire observer when unobserved token count exceeds threshold
- BlockAfter safety: stop accepting new messages if observation backlog is too large
- Reflection: condense observations when they exceed reflection threshold
- Continuation metadata: `current_task`, `suggested_continuation`, `last_observed_at`
- Observation groups: link observation text to original message ranges for `recall` tool

**Durability rule**: observation is NOT marked as observed until the DB write succeeds.

**Prompt injection position**: System prompt — as compressed historical context before working memory.

**Scope behavior**:

- `thread`: per-thread observation record (current)
- `project`: future — project-level observations persisted by AutoDream
- `agent`: future — subagent operational memory

### Layer 4 — Semantic Recall

**Purpose**: Similarity-based retrieval. Relevant messages, observations, decisions, memory artifacts, handoff notes, working memory snapshots, reusable patterns.

**Characteristics**:

- Index of important memory artifacts (observations, working memory snapshots, handoff notes, user-saved patterns)
- FTS5 backend in V1 (keyword-based search)
- Clean extension interface for future vector/embedding backends
- Scope-aware: search can be scoped to thread, agent, project, user, or global_pattern
- Composed into context via a configurable retrieval budget

**Prompt injection position**: System prompt — before working memory. Surfaces contextually relevant prior knowledge.

**Scope behavior**:

- Any scope can be searched
- Retrieval priority: `thread` > `agent` > `project` > `user` > `global_pattern`
- Cross-scope: a project-scope query can optionally include user-scope results

---

## Scope Model

### Canonical Scopes

| Scope            | Key                  | Description                                              |
| ---------------- | -------------------- | -------------------------------------------------------- |
| `thread`         | thread ULID          | One concrete conversation/session                        |
| `agent`          | agent ID             | One subagent's operational memory                        |
| `project`        | project path         | Shared memory across all agents/sessions for one project |
| `user`           | user ID or "default" | User-wide durable memory                                 |
| `global_pattern` | pattern key          | Abstract reusable patterns across projects               |

### Scope Inheritance

Scope inheritance for context composition (read order, not write order):

```
thread → agent → project → user → global_pattern
```

Reading working memory: thread first, then agent, then project, then user, then global patterns.
Writing working memory: always explicit — no implicit inheritance on writes.

### Scope Isolation

- A thread cannot write to project or user scope directly — only via explicit tools.
- A `global_pattern` scope record does NOT contain project-private details.
- Scope boundaries are enforced at the repository layer.

---

## Migration Expectations

### What Is Replaced

| Old System                                                              | New System                                                  | Migration Action                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `AutoDream` + Engram MCP for cross-session recall                       | Native `MemoryProvider` with project-scoped semantic recall | AutoDream refactored to write to native memory core |
| Engram `mem_context` / `mem_search` MCP call in `SystemPrompt.recall()` | Native `MemoryProvider.buildContext()`                      | `system.ts` recall path replaced                    |
| In-memory fork maps                                                     | `fork_contexts` table in SQLite                             | Fork write added before fork is live                |

### What Is Preserved

| Existing Feature                                        | Status                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| Intra-session OM observer/reflector pipeline            | **Preserved** — wrapped by new `ObservationalMemoryService`     |
| `ObservationTable` and `ObservationBufferTable` schemas | **Extended** — new columns added, not dropped                   |
| Existing `session.sql.ts` tables                        | **Untouched** — migrations are additive                         |
| Engram MCP server and tools                             | **Preserved** — available as community tool, no longer required |

### What Is Intentionally Reset

- AutoDream Engram sync state (the `autodream.json` file and any pending Engram writes are not migrated)
- Engram cross-session observations from the external `~/.engram` DB are NOT automatically imported. A manual import helper can be built later but is out of scope for V1.

### No Silent Data Loss

- All existing `ObservationTable` records are preserved
- All existing session/message/part data is preserved
- The new memory tables are added as additive migrations
- No existing column is dropped or renamed

---

## Validation Expectations

All four memory layers must have:

1. DB initialization test (fresh DB, migrations run without error)
2. Write + read round-trip test
3. Scope isolation test (writes to scope A don't appear in scope B)
4. Durability test (write persists after DB close + reopen)

Observational memory must additionally have:

5. Durability-on-failure test (observation not marked observed if DB write fails)
6. Activation threshold test
7. BlockAfter safety test
8. Continuation metadata test

Fork/handoff must additionally have:

9. Fork context survives restart test
10. Parent → child context propagation test

Semantic recall must additionally have:

11. FTS5 keyword search test
12. Scope-filtered search test
13. Topic-key dedupe test

---

## Rollout Expectations

### Phase A — Foundation (This Initiative)

- All four memory layers implemented
- One SQLite DB path
- `MemoryProvider` abstraction in place
- Working memory and semantic recall are first-class
- Fork/handoff durable
- AutoDream writes to native memory core
- `SystemPrompt.recall()` reads from native memory core

### Phase B — Enhanced Recall (Future)

- Vector/embedding backend for semantic recall (replace FTS5 with optional vector index)
- Agent-scope OM observations (subagent memory beyond just thread-scope)
- Cross-project global_pattern recall

### Phase C — User-Wide Memory (Future)

- User-scope working memory persisted to a portable store
- Cross-device sync (requires cloud backend, out of V1 scope)

---

## Risks

| Risk                                                             | Severity | Mitigation                                                                                                     |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| R-1: Existing OM session data broken during migration            | HIGH     | Additive-only schema migrations; full test coverage of existing OM paths                                       |
| R-2: Performance regression on context build (extra DB queries)  | MEDIUM   | Batch reads in `buildContext()`; lazy load semantic recall                                                     |
| R-3: Working memory + observational memory conceptually confused | HIGH     | Strict schema separation; different update paths; documented clearly in code                                   |
| R-4: Fork context written after fork is live (race condition)    | HIGH     | Fork context write is transactional and blocking before fork is considered active                              |
| R-5: Semantic recall returns stale/irrelevant results            | MEDIUM   | Scope filtering; limit result budget; topic-key weighting in FTS5                                              |
| R-6: AutoDream refactor breaks existing dream consolidation      | MEDIUM   | Feature-flag AutoDream to use either Engram MCP or native memory core                                          |
| R-7: SQLite contention under parallel agent execution            | MEDIUM   | WAL mode (already configured); busy_timeout 5s (already configured); serialized writes via transaction helpers |
| R-8: `global_pattern` scope leaks project-private data           | HIGH     | Explicit scope check at write time; `global_pattern` writes require stripping private markers                  |
| R-9: Memory context grows too large for context window           | MEDIUM   | Token budget per layer; cap each layer independently; total context cap enforced in `buildContext()`           |
