# LightCode Memory Core V3 Specification

## 1. Overview

The LightCode Memory Core has evolved through two major iterations:

- **V1 Baseline**: Established the native memory module, including contracts, schema, working-memory, semantic-recall, handoff, and provider. It introduced 5 DB tables (`memory_working`, `memory_artifacts` with FTS5, `memory_agent_handoffs`, `memory_fork_contexts`, `memory_links`). It also laid the groundwork with guards like `observeSafe()` and helpers like `persistConsolidation()`, alongside native recall paths and feature flags.
- **V2 Baseline**: Delivered Object Memory (OM) atomicity by moving seal+trackObserved inside an async closure after `addBuffer` succeeds. It captured Dream outputs via `daemon.ts` fetching output and calling `persistConsolidation()`. It fixed recall queries to use `lastUserMessage.text` instead of the project UUID, loaded `projectWorkingMemory()` at step 1 into the system prompt, registered the `update_working_memory` agent tool, improved recall quality with 800-character previews and FTS error logging (with `SemanticRecall.recent()` fallback), and removed the Engram gate from `idle()`.

**V3 Goal**: The V3 release aims to solidify the core by fixing critical bugs in the agent fork path, establishing a canonical memory composition and durability path, cleaning up dead code, and fully transitioning away from legacy Engram dependencies where appropriate.

## 2. Problem Statement (Critical V3 Gaps)

Code audits have revealed the following critical gaps in the current implementation:

### Gap 1 — Fork path is broken by a step counter bug (CRITICAL)

In `packages/opencode/src/session/prompt.ts`:

- Line 1467: `let step = 0`
- Line 1511: `step++` (incremented BEFORE fork check)
- Line 1635: `const fork = forks.get(sessionID)`
- Line 1636: `if (fork && step === 0) {` (always false because step is already 1)

The fork context stashed in `activeContexts` is **never consumed**. Child sessions always go through the normal execution path without any parent context.

### Gap 2 — Fork children get zero memory context (CRITICAL)

Even if Gap 1 were fixed, the fork path at lines 1635-1683 passes `undefined` for `recall`, `observations`, and `workingMemory` because they are loaded at `step === 1` and not yet set in the fork context block. Child agents start entirely blind.

### Gap 3 — Memory.writeForkContext / getForkContext never called

The DB persistence layer for fork contexts (`memory_fork_contexts` table) exists but is disconnected:

- `Memory.writeForkContext()`: zero callers in the entire codebase.
- `Memory.getForkContext()`: zero callers in the entire codebase.

Fork context currently flows only through in-memory maps, meaning it is lost on restart.

### Gap 4 — activeContexts map never cleaned up (memory leak)

In `prompt.ts`, line 1833: `activeContexts.set(sessionID, {...})` — entries are added every turn, but no code ever deletes from `activeContexts`. This map grows unboundedly.

### Gap 5 — Memory.buildContext() not in hot path

`Memory.buildContext()` (`provider.ts:53`) has zero callers in the live codebase. Instead, the runtime calls `SystemPrompt.recall()`, `SystemPrompt.observations()`, and `SystemPrompt.projectWorkingMemory()` separately. This scatters the composition logic instead of utilizing a single canonical entry point.

### Gap 6 — observeSafe() is dead code

In `record.ts` lines 129-140, `observeSafe()` is defined but has zero callers. It was intended to replace upsert+seal in `prompt.ts`, but `prompt.ts` now uses `addBuffer`+`activate`. It is architecturally obsolete and should be removed.

### Gap 7 — No automatic project memory indexing

`memory_artifacts` is only populated by the AutoDream daemon conditionally. There is no per-session indexing, and no harvesting of OM observations into artifacts. The project memory layer is passive and only grows when AutoDream runs.

### Gap 8 — No agent guidance for when to use update_working_memory

The `update_working_memory` tool exists and is registered, but the system prompt lacks instructions telling agents when to proactively use it. Agents are left to infer usage solely from the tool description.

### Gap 9 — dream/index.ts:run() still calls Engram.ensure()

Line 95: `const available = await Engram.ensure()` blocks the manual `/dream` command for users without the Engram binary, even though the daemon-based dream path doesn't require it.

### Gap 10 — TUI app.tsx still calls Engram.setRegistrar()

`cli/cmd/tui/app.tsx` line 268: `Engram.setRegistrar(...)` maintains active TUI integration for auto-connecting the legacy Engram MCP server. This should be retained but explicitly isolated.

## 3. Product Goals

- Sub-agents (forks) must inherit full context seamlessly from their parents, never starting "blind."
- Memory summarization and indexing should occur proactively and automatically, reducing reliance on background daemons alone.
- Agents must actively and correctly maintain the project's working memory.
- Manual triggers like `/dream` must work natively regardless of external binary dependencies (Engram).

## 4. Technical Goals

- **Fix the Fork Path:** Correct lifecycle sequencing so forks properly hydrate and consume state.
- **Canonical Composition:** Route all runtime memory context assembly through a single entry point (`Memory.buildContext()`).
- **Canonical Durability:** Clean up dead persistence code (`observeSafe()`) and connect isolated DB paths (`memory_fork_contexts`).
- **Resource Management:** Ensure unbounded in-memory caches (`activeContexts`) are properly pruned.
- **Decoupling:** Decouple native features from legacy Engram binaries where appropriate.

## 5. Success Criteria

1. **Gap 1 (Step Bug):** Sub-agents successfully enter the fork initialization block (`fork && step === 0` logic corrected) verified via test/log.
2. **Gap 2 (Fork Memory):** Fork children correctly receive non-undefined `recall`, `observations`, and `workingMemory` from their parents.
3. **Gap 3 (Fork Persistence):** `Memory.writeForkContext()` and `Memory.getForkContext()` are called during the fork lifecycle instead of relying solely on transient memory.
4. **Gap 4 (Memory Leak):** `activeContexts` map entries are explicitly deleted after use or when a session is finalized.
5. **Gap 5 (Composition):** `Memory.buildContext()` is the sole entry point for assembling memory context in the hot path.
6. **Gap 6 (Dead Code):** `observeSafe()` is completely removed from the codebase.
7. **Gap 7 (Auto Indexing):** Session finalization or turn completion proactively indexes relevant OM observations into `memory_artifacts`.
8. **Gap 8 (Agent Guidance):** The system prompt explicitly instructs the agent on _when_ and _why_ to call `update_working_memory`.
9. **Gap 9 (Manual Dream):** Running `/dream` succeeds natively without the Engram binary installed.
10. **Gap 10 (TUI Isolation):** Engram legacy TUI connection logic is logically isolated and clearly documented as a legacy adapter.

## 6. Non-Goals

- We are not rewriting the entire Object Memory (OM) atomicity model.
- We are not redesigning the database schema (existing tables remain unchanged).
- We are not building a new UI for memory management.

## 7. Constraints

- The V3 implementation must remain backward compatible with existing session histories and database states.
- Performance in the hot path (prompt building) must not degrade when switching to `Memory.buildContext()`.

## 8. Concretely: What "fork path fixed" means

- The variable `step` must be checked before it is prematurely incremented, ensuring the condition `step === 0` correctly routes the first turn of a forked session into the fork hydration logic.
- The state provided to the child must include fully resolved `recall`, `observations`, and `workingMemory` objects fetched via the fork context.
- Instead of using a leaky `activeContexts` map, the system will persist fork contexts using `Memory.writeForkContext()` on the parent side, and `Memory.getForkContext()` on the child side, allowing forks to survive process restarts. Transient tracking maps must be explicitly cleared once a fork is hydrated.

## 9. Concretely: What "canonical runtime composition path" means

- The scattered calls to `SystemPrompt.recall()`, `SystemPrompt.observations()`, and `SystemPrompt.projectWorkingMemory()` in the session lifecycle will be removed.
- They will be replaced by a single call to `Memory.buildContext(sessionID, projectID, query)`, which returns a standardized, unified context object containing all necessary memory layers.
- The system prompt instructions will be updated to explicitly direct the agent to utilize `update_working_memory` at appropriate lifecycle events (e.g., when a decision is made or context shifts).

## 10. Concretely: What "canonical OM durability path" means

- Architecturally obsolete functions like `observeSafe()` will be deleted.
- The Object Memory system will proactively flush/index key observations into `memory_artifacts` at the end of meaningful session boundaries, rather than relying exclusively on the passive AutoDream daemon.
- This creates a continuous, active persistence cycle: `addBuffer` -> `activate` -> `Session End` -> `Index Artifact`.

## 11. Migration/Compatibility Expectations

- Existing sessions in SQLite will not require migrations; V3 utilizes the existing V2 schema.
- Removing `Engram.ensure()` from `/dream` means users relying solely on the native SQLite implementation will have a frictionless experience without breaking legacy paths.
- The TUI integration (`app.tsx`) will keep `Engram.setRegistrar()` for users who still run the legacy MCP server, but it will be explicitly marked and isolated as a legacy adapter.

## 12. Risks

- **Concurrency in Forking:** Shifting fork contexts from in-memory maps to the database might introduce slight latency or race conditions if the child starts before the parent's DB write completes.
- **Prompt Size Bloat:** Automatically providing full memory context (recall, observations, working memory) to sub-agents could inflate token usage. We must ensure the `Memory.buildContext()` trims or limits the context size appropriately (e.g., adhering to the 800-character preview limits).
