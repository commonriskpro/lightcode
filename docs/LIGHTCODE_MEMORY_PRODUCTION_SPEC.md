# LightCode Memory Production Specification

## 1. Overview

The LightCode Memory system already has a native SQLite-backed core in production use, but still required a final code-truth cleanup to tighten precedence semantics, improve recall quality, operationalize agent scope, and consume durable child-session state more meaningfully. This initiative addresses those remaining code-level issues without rebuilding the architecture.

## 2. Problem Statements (Code Audit Findings)

### Bug 1 — Working Memory Precedence (CRITICAL)

- **File:** `packages/opencode/src/memory/working-memory.ts` (lines 58-68)
- **Problem:** The deduplication key in `getForScopes()` is set to `"${r.scope_type}:${r.key}"` instead of `"${r.key}"`. If both `thread` and `project` scopes contain the same key (e.g., `"goals"`), both records are returned instead of the more specific one (thread) overriding the broader one (project). The code fails to implement the "most specific wins" rule stated in the comments.

### Bug 2 — FTS5 Recall Quality (MEDIUM)

- **File:** `packages/opencode/src/memory/semantic-recall.ts` (lines 42-49)
- **Problem:** The `sanitizeFTS()` function wraps each token in double quotes, forcing exact-AND matching. A query for `"auth"` does not match `"authentication"`, and multi-word queries like "how does authentication work" require all tokens to match exactly, resulting in near-zero results. There is no OR-mode or fuzzy matching fallback.

### Bug 3 — No FTS5 Fallback in Hot Path (MEDIUM)

- **File:** `packages/opencode/src/memory/provider.ts` (lines 66-68)
- **Problem:** `Memory.buildContext()` has no fallback to `SemanticRecall.recent()` when FTS returns 0 results. While a fallback exists in `system.ts:recallNative()`, that function is dead code with no callers from the hot path. Consequently, the primary runtime memory composition path silently returns an empty recall when FTS fails.

### Bug 4 — OPENCODE_MEMORY_USE_ENGRAM Flag Never Checked (LOW)

- **File:** `packages/opencode/src/flag/flag.ts` and `packages/opencode/src/session/system.ts`
- **Problem:** The `OPENCODE_MEMORY_USE_ENGRAM` flag is defined but never referenced in runtime code. The Engram path is dead because it has no callers, not because of the flag. This makes the flag documentation misleading.

### Bug 5 — Scope Model Partially Operational (LOW)

- **File:** Schema and Tool definitions
- **Problem:** Only `thread` and `project` scopes are actively used in the hot path. Scopes like `agent`, `user`, and `global_pattern` exist in the schema but are not automatically written to. The `UpdateWorkingMemoryTool` only exposes `thread` and `project` scopes to agents.

### Bug 6 — runLoop Overloaded (MEDIUM)

- **File:** Main runLoop implementation
- **Problem:** The main `runLoop` is a 452-line `while(true)` loop handling 12 distinct concerns without helper functions for OM coordination or prompt assembly. This high coupling makes adding new memory behaviors risky and hinders maintainability.

### Bug 7 — Durable fork/handoff state was write-heavy but read-light (MEDIUM)

- **Files:** `packages/opencode/src/tool/task.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/memory/handoff.ts`
- **Problem:** Durable fork and handoff state was being written to the DB but the runtime still depended too heavily on in-memory state. Child-session hydration needed to consume `Memory.getHandoff()` / `Memory.getForkContext()` in the hot path so restart recovery was meaningfully useful.

## 3. Product Goals

- Ensure working memory correctly applies precedence rules (most specific scope wins).
- Improve semantic recall quality so users get relevant historical context even with partial or multi-word queries.
- Ensure the memory system degrades gracefully (falling back to recent memory when search yields no results).
- Streamline memory tool usage by exposing operational scopes logically to the agents.
- Make durable child-session recovery useful enough to matter after restart.

## 4. Technical Goals

- Fix the deduplication logic in working memory retrieval.
- Implement a two-pass FTS5 search (AND-mode with prefix matching, falling back to OR-mode).
- Connect the semantic recall fallback in the runtime hot path (`Memory.buildContext()`).
- Reduce ambiguity inside the overloaded `runLoop` by clarifying ownership boundaries in code and isolating the canonical memory/OM sections, without requiring a risky full extraction in this initiative.
- Clean up dead code, unreferenced flags, and document dormant features to reduce technical debt.
- Keep the fast in-memory fork path as an optimization while making DB-backed hydration a meaningful fallback.

## 5. Success Criteria

- **Bug 1:** A test with identical keys in `thread` and `project` scopes returns only the `thread` record.
- **Bug 2:** A search for "auth JWT" successfully matches entries containing "authentication" and "JWT".
- **Bug 3:** Queries returning 0 FTS results automatically trigger and return results from `SemanticRecall.recent()`.
- **Bug 4/6:** `OPENCODE_MEMORY_USE_ENGRAM`, `recallEngram()`, and `recallNative()` are removed from live runtime implementations and no core runtime path depends on them.
- **Bug 5:** The `agent` scope is passed in the hot path and exposed in `UpdateWorkingMemoryTool`.
- **Bug 6:** The main `runLoop` has clearer ownership boundaries for OM coordination and memory assembly, and production maintainability is improved without changing runtime behavior incorrectly.
- **Bug 7:** Child sessions can hydrate useful context from durable fork/handoff records when needed.

## 6. Non-Goals

- Implementing the fully functional `user` or `global_pattern` memory scopes in this initiative.
- Re-architecting the entire session prompt assembly outside of the specific OM cycle extraction.
- Rebuilding the Engram memory path (it is being removed/cleaned up for now).

## 7. Constraints

- Changes must be backward compatible with existing memory SQLite databases (no schema changes required for these fixes).
- Performance in the hot path (`Memory.buildContext`) must not degrade significantly despite adding fallback searches.

## 8. Canonical Definitions

- **Working Memory Precedence:** The rule that when multiple active scopes contain the same memory key, the value from the most specific scope (e.g., thread > project) is used, and broader scopes are ignored.
- **FTS5 Production-Quality:** A search implementation that prioritizes exact/AND matches for high precision but gracefully falls back to OR/prefix matches to ensure high recall, preventing empty results for reasonable queries.
- **Engram Boundary:** The division between local SQLite working/semantic memory and the persistent, cross-session Engram storage. In this phase, the dead local Engram bridge code is being removed to clarify this boundary.

## 9. Migration/Compatibility Expectations

- No database migrations are needed.
- Existing memory records will automatically benefit from improved FTS5 search and correct WM deduplication upon deployment.

## 10. Production-Readiness Gates

- All existing and new memory unit tests must pass (`bun typecheck` and test suites in `packages/opencode`).
- Dead code removal must be verified to not break any existing agent workflows.
- `SUPERSEDED.md` must be updated to reflect the removal of the dead Engram flags and paths.
