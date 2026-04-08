# Design — Remove `SemanticRecall` Shim & Wire Hybrid Indexing

## Context

The `embedding-recall` change introduced `HybridBackend` (FTS5 + embeddings via RRF) but left
`SemanticRecall` as a deprecated compatibility namespace. Audit of the codebase reveals two
problems that cannot wait for v3:

1. **Silent embedding bug**: `Memory.indexArtifact()` — called by `session/prompt.ts` (session-end
   auto-indexing) and `dream/index.ts` (dream consolidation) — still routes through
   `SemanticRecall.index()` → `FTS5Backend.indexSync()`, bypassing `EmbeddingBackend` entirely.
   **Production writes never generate embeddings.** Only reads via `Memory.buildContext()` use
   `HybridBackend`. This is a real fuga, not a cosmetic issue.
2. **Dead shim surface**: `SemanticRecall` + the `indexSync`/`searchSync` methods on
   `FTS5Backend` exist solely to satisfy 5 legacy test files. There are no other callers.

Goal: delete the shim, fix the indexing bug, and preserve all non-shim test coverage by
migrating tests to `FTS5Backend` directly or to the (now async) `Memory.indexArtifact`.

## Non-Goals

- Redesigning `HybridBackend`, `EmbeddingBackend`, or `SessionMemory` (already shipped).
- Changing the public `Memory.buildContext()` shape.
- Embedding tool, CLI, or REPL APIs that do not currently touch `SemanticRecall`.
- Rewriting docs that describe pre-v3 architecture (marked as historical).

## Investigation Summary

### Producción — usos reales de `SemanticRecall`

| File                         | Line | Call                                                                          | Notes                                                                           |
| ---------------------------- | ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/memory/provider.ts`     | 17   | `import { SemanticRecall }`                                                   | Must remove                                                                     |
| `src/memory/provider.ts`     | 138  | `SemanticRecall.format(artifacts, rBudget)`                                   | Replace with `format` from `./fts5-backend`                                     |
| `src/memory/provider.ts`     | 200  | `SemanticRecall.search(query, scopes, limit)` inside `Memory.searchArtifacts` | Replace with `HybridBackend.search` (async)                                     |
| `src/memory/provider.ts`     | 204  | `SemanticRecall.index(artifact)` inside `Memory.indexArtifact`                | Replace with `HybridBackend.index` (async) **← fixes the silent embedding bug** |
| `src/memory/index.ts`        | 22   | `export { SemanticRecall }`                                                   | Must remove                                                                     |
| `src/memory/fts5-backend.ts` | 11   | JSDoc reference                                                               | Comment cleanup                                                                 |

### Producción — callers de `Memory.indexArtifact` / `Memory.searchArtifacts`

| Caller                                                | Sync/Async context                                   | Current signature | Impact                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `src/session/prompt.ts:233` (`indexSessionArtifacts`) | Inside `Effect.gen`; current fn is plain sync `void` | sync              | Wrap as fire-and-forget promise inside existing `try/catch` — already marked "non-fatal"   |
| `src/dream/index.ts:142` (`persistConsolidation`)     | Plain sync `void` fn                                 | sync              | Wrap as fire-and-forget promise inside existing `try/catch` — already marked "best-effort" |
| `Memory.searchArtifacts`                              | —                                                    | —                 | **No production callers found.** Only used by legacy tests. Safe to turn async.            |

Both call-sites already swallow errors and are semantically fire-and-forget. Converting
`Memory.indexArtifact` to async does not cascade up into the Effect runtime.

### Producción — callers de `indexSync` / `searchSync` en `FTS5Backend`

Only `semantic-recall.ts`. Zero other callers. These two methods become orphaned the moment
the shim is deleted; inline them into the async `index` / `search` methods and delete the sync
variants.

### Tests — uso de `SemanticRecall` (5 files, 112 matches)

Full audit lives in the investigation log. Per-file verdicts:

| File                             | Verdict                        | Delete                        | Migrate                                                                                                             | Keep as-is                                                                                              |
| -------------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `memory-core.test.ts`            | **SPLIT**                      | 5 redundant tests             | 6 tests (scope filter, special chars, different topic_keys, hash dedupe, format budget, `buildContext` recall path) | WM / Handoff / migration / `<private>` / `clearScope` / provider tests                                  |
| `memory-core-v2.test.ts`         | **SPLIT**                      | 7 regression duplicates       | 4 tests (`recent()` fallback, DESC order, scope filter, format 800-char preview)                                    | OM / SystemPrompt / tool / Dream tests                                                                  |
| `memory-core-v3.test.ts`         | **DELETE ENTIRELY**            | 16 of 17 redundant            | —                                                                                                                   | —                                                                                                       |
| `memory-core-final.test.ts`      | **SPLIT**                      | 13 redundant / surface guards | 0 (surviving tests don't use SemanticRecall)                                                                        | `addBufferSafe` merge, enriched fork JSON, provider handoff, `<memory-recall>` tag                      |
| `memory-core-production.test.ts` | **SPLIT** (highest-value file) | 14 redundant                  | 4 FTS-sanitizer tests                                                                                               | **P-1 WM precedence** (critical), `ctx.blocks` ordering, permission gate, recency fallback, agent scope |

### Coverage gaps the legacy files protect (must not be lost)

1. `WorkingMemory`: CRUD, versioning, scope precedence chain (thread > agent > project > user > global_pattern), `<private>` tag stripping, `clearScope`
2. `Memory.buildContext`: token budgets, recency fallback, `ctx.blocks` metadata/ordering
3. `Handoff` / fork context round-trips (service + provider)
4. `OM` / `OMBuf`: `addBufferSafe` atomicity, observed-id merging, seal state machine
5. `SystemPrompt`: `wrapWorkingMemory` guidance, `<memory-recall>` tag
6. `UpdateWorkingMemoryTool` / `UpdateUserMemoryTool`: schema validation, registry, **permission approval flow** (security-critical)
7. `AutoDream`: `persistConsolidation`, `buildSpawnPrompt`
8. `Flag.OPENCODE_MEMORY_USE_ENGRAM` removal guard
9. FTS5 sanitizer (`AND OR NOT`, `:`, parens)
10. Hash dedupe 15-minute window
11. `format()` budget + 800-char preview
12. `recent()` ordering and scope filtering

### Docs & README

35 references to `SemanticRecall` across docs. Split:

- **Historical / superseded docs**: leave as-is. Add a one-line header note if needed.
- **Active docs** (`README.md`, `docs/feature-catalog.md`, `docs/autodream-architecture.md`,
  `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`): update to reference `HybridBackend` / `Memory.indexArtifact`.
- `docs/LIGHTCODE_MEMORY_CORE_V1/V2/V3_*.md`: historical specs — no changes.

## Proposed Architecture

```
Before (current state, buggy):
┌─────────────────────────┐
│ session/prompt.ts       │──┐
│ dream/index.ts          │──┤ sync
└─────────────────────────┘  │
                             ▼
                    ┌──────────────────┐        ┌─────────────────┐
                    │ Memory           │──sync──│ SemanticRecall  │
                    │ .indexArtifact   │        │ (shim namespace)│
                    │ .searchArtifacts │        └────────┬────────┘
                    └──────────────────┘                 │
                                                         ▼
                                              ┌──────────────────┐
                                              │ FTS5Backend      │
                                              │ .indexSync       │  ← embeddings NEVER generated
                                              │ .searchSync      │
                                              └──────────────────┘

Memory.buildContext() (separate path, correct):
    HybridBackend → [FTS5Backend async] + [EmbeddingBackend]
```

```
After:
┌─────────────────────────┐
│ session/prompt.ts       │──┐
│ dream/index.ts          │──┤ async caller, awaited inside try/catch
└─────────────────────────┘  │   (runs after user already has response;
                             │    same phase as Mastra's processOutputResult)
                             ▼
                    ┌──────────────────┐
                    │ Memory           │  async
                    │ .indexArtifact   │─────┐
                    │ .searchArtifacts │     │
                    └──────────────────┘     │
                                             ▼
                                   ┌──────────────────┐
                                   │ HybridBackend    │
                                   │ (singleton)      │
                                   └────────┬─────────┘
                                            │
                              ┌─────────────┴──────────────┐
                              ▼                             ▼
                    ┌──────────────────┐          ┌──────────────────┐
                    │ FTS5Backend      │          │ EmbeddingBackend │
                    │ .index (async)   │          │ .index (async)   │
                    │ .search (async)  │          │ .search (async)  │
                    └──────────────────┘          └──────────────────┘
```

## Design Decisions

### D1. `Memory.indexArtifact` / `Memory.searchArtifacts` become async

**Alternatives considered:**

- **A. Keep sync, route through a new `FTS5Backend` instance synchronously.** Fastest, but
  leaves the embedding bug unfixed. Rejected.
- **B. Go async and route through `HybridBackend`.** Matches `buildContext()`'s path, fixes the
  bug, lets indexing generate embeddings when an embedder is configured. **Chosen.**
- **C. Add a parallel `indexArtifactAsync` and keep sync as passthrough.** Doubles the API surface
  with no benefit once the shim is gone. Rejected.

**Implications:**

- `MemoryProvider` interface (`contracts.ts`) changes: return types become `Promise<string>` /
  `Promise<MemoryArtifact[]>`.
- Two production call-sites (`session/prompt.ts:233`, `dream/index.ts:142`) must handle promises.
  Both already have `try/catch` with a silent-fail comment. See D1b for the exact await pattern
  (awaited, NOT fire-and-forget).

### D1b. Awaited post-turn indexing, Mastra-style (NOT fire-and-forget)

**Context:** the first draft of this design proposed `void Memory.indexArtifact(...).catch(() => {})`
(fire-and-forget). Validated against Mastra's reference implementation
(`packages/core/src/processors/memory/semantic-recall.ts` + `packages/core/src/processors/runner.ts`
in `mastra-ai/mastra`) we're switching to awaited execution.

**What Mastra does (verified against source, not docs):**

In `runner.ts` `runOutputProcessors()`, the call to `processor.processOutputResult(...)` — which is
where `SemanticRecall` generates embeddings and upserts them into the vector store — is `await`ed.
The request doesn't finish until the embeddings are written. But this phase runs **after** the
LLM stream has completed, so the user has already received their response by the time embedding
starts. Inside `processOutputResult`, Mastra uses two layers of `try/catch`: one per message (log,
skip, continue) and one global (log, return messageList intact so the error never propagates to
the agent).

**Lightcode mapping:**

| Mastra                                                          | Lightcode equivalent                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `processOutputResult` awaited in `runner.ts` after stream       | `indexSessionArtifacts` runs at session loop exit — user already has their assistant msg |
| Awaited write means user request finishes after embeddings      | Loop iteration finishes after embeddings, before cleanup                                 |
| `try/catch` silences errors so the agent response isn't blocked | `prompt.ts` already wraps the call in a silent `try/catch` marked "non-fatal"            |
| `dream/index.ts` `persistConsolidation` already has `log.warn`  | Same — just move it inside the `await` block                                             |

**Why awaited beats fire-and-forget here:**

1. **Observability**: `.catch(() => {})` swallows everything. `await` inside `try/catch` lets us
   log meaningful warnings (which `dream/index.ts` already does — we'd lose that with fire-and-forget).
2. **No race with cleanup**: session/fork cleanup could run while a detached embedding promise is
   still writing. Awaiting removes the race entirely.
3. **Deterministic tests**: tests that call `Memory.indexArtifact` then immediately query expect
   the write to be visible. Fire-and-forget forces arbitrary sleeps. Awaited "just works".
4. **Backpressure**: under a burst of sessions closing, fire-and-forget leaks unbounded detached
   promises into the event loop. Awaiting serializes naturally with the session loop.
5. **Validated by production**: Mastra is a mature agent framework used in production; their
   decision to `await` is already load-tested.

**Fire-and-forget has exactly one benefit:** the outer caller stays sync. We don't care —
`indexSessionArtifacts` and `persistConsolidation` have **one caller each**, both trivial to
migrate.

**Concrete pattern for `session/prompt.ts` `indexSessionArtifacts`:**

```ts
async function indexSessionArtifacts(sessionID: SessionID): Promise<void> {
  const finalObs = OM.get(sessionID)
  const obsContent = finalObs?.reflections ?? finalObs?.observations
  if (!obsContent || obsContent.length <= 100) return

  const obsTitle = /* ...existing title derivation... */

  try {
    await Memory.indexArtifact({
      scope_type: "project",
      scope_id: Instance.project.id,
      // ...existing fields...
    })
  } catch (err) {
    // Non-fatal — session end indexing failure does not affect session result.
    // But we DO log it so embedding write failures are observable.
    log.warn("session-end artifact indexing failed", {
      sessionID,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

The caller at line 1958 (inside `Effect.gen`) becomes:

```ts
// was: indexSessionArtifacts(sessionID)
yield * Effect.promise(() => indexSessionArtifacts(sessionID))
```

The outer `try/catch` at line 1957–1961 can be removed — the function now handles its own errors.
Alternative: keep the outer `try/catch` as defense-in-depth against bugs in the title-derivation
logic itself. **Chosen: keep the outer guard**, because the title derivation accesses `Instance.project.id`
which could still sync-throw if `Instance` is in a bad state, and that path isn't inside the async
function's `try/catch`.

**Concrete pattern for `dream/index.ts` `persistConsolidation`:**

```ts
export async function persistConsolidation(
  projectId: string,
  title: string,
  content: string,
  topicKey?: string,
): Promise<void> {
  if (!Flag.OPENCODE_DREAM_USE_NATIVE_MEMORY) return
  try {
    await Memory.indexArtifact({
      scope_type: "project",
      scope_id: projectId,
      // ...existing fields...
    })
    log.info("dream consolidation persisted to native memory", { projectId, title })
  } catch (err) {
    log.warn("dream consolidation native write failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

**Caller update (confirmed):** the single caller is `packages/opencode/src/dream/daemon.ts:141`,
already inside an `async` function wrapped in `try/catch`. Change:

```ts
// was: AutoDream.persistConsolidation(projectDir, title, outputText, topicKey)
await AutoDream.persistConsolidation(projectDir, title, outputText, topicKey)
```

No other structural change needed — the outer `try/catch (captureErr)` at lines 150–154 already
catches and logs. The inner `log.warn` from D1b is defense-in-depth.

### D2. Singleton `HybridBackend` shared between `buildContext` and `indexArtifact`

Currently `provider.ts` has `let backend: Promise<HybridBackend> | undefined` and
`getBackend()` helper at module scope. Reuse it for `indexArtifact` / `searchArtifacts` — no
second instance, no second embedder boot.

`getBackend()` is already async and handles the `null`-embedder degradation path.

### D3. Inline `indexSync` / `searchSync` into async `index` / `search`

`FTS5Backend.index` and `.search` are currently trivial `async` wrappers over sync bodies.
After the shim is gone, delete the `*Sync` methods and move the sync bodies directly into the
async methods. No behavior change. Async is necessary because `RecallBackend` interface is
async (set by `embedding-recall`), even though FTS5's underlying SQLite calls are sync.

### D4. Delete `semantic-recall.ts` file entirely

Not rename, not move to a `compat/` folder. Full delete. The file is 80 lines of pure
delegation.

### D5. Preserve legacy test coverage via targeted SPLIT, not wholesale deletion

Based on audit:

- `memory-core-v3.test.ts` deleted entirely (16 of 17 redundant).
- Other 4 files: SPLIT per audit — delete redundant tests, migrate `SemanticRecall.*` calls to
  `new FTS5Backend()` directly for non-redundant ones, keep non-shim tests untouched.

**Migration pattern** (mechanical):

```ts
// before
import { SemanticRecall } from "../../src/memory/semantic-recall"
SemanticRecall.index({ ... })            // returns string (sync)
SemanticRecall.search(q, scopes, 10)      // returns MemoryArtifact[] (sync)
SemanticRecall.recent(scopes, 5)          // sync
SemanticRecall.get(id)                    // sync
SemanticRecall.format(arts, budget)       // sync
SemanticRecall.remove(id)                 // sync

// after
import { FTS5Backend, format } from "../../src/memory/fts5-backend"
const fts = new FTS5Backend()
await fts.index({ ... })                  // returns Promise<string>
await fts.search(q, scopes, 10)            // returns Promise<MemoryArtifact[]>
fts.recent(scopes, 5)                      // stays sync (not on RecallBackend interface)
fts.get(id)                                // stays sync
format(arts, budget)                       // stays sync, imported as free function
await fts.remove(id)                       // returns Promise<void>
```

**Test body impact**: every test that calls `SemanticRecall.index` or `SemanticRecall.search` must
become `async` and `await` the call. Bun test supports async test functions natively.

### D6. Tests that call `Memory.indexArtifact` / `Memory.searchArtifacts`

These now return promises. Update test callers to `await`.

- `memory-core-final.test.ts` L267, L289: `Memory.indexArtifact({ ... })` → `await Memory.indexArtifact({ ... })`
- `memory-core-v3.test.ts` L192, L197, L221, L235: same pattern. (This file is being deleted per D5 anyway, so these migrations only apply to other files.)
- `memory-core-v2.test.ts` L181: `searchArtifacts` test → `await`.

### D7. No TypeScript interface "v3 deprecation" — remove interface methods directly

Since `Memory.searchArtifacts` has **zero production callers**, it's safe to:

- Keep it on the interface (as `Promise<MemoryArtifact[]>`) because tests still call it, OR
- Drop it from the interface and rewrite those tests to hit `HybridBackend` / `FTS5Backend` directly.

**Decision:** Keep it, just turn async. Fewer test edits, preserves provider API surface.

## File-by-File Change List

### Delete

| Path                                                   | Lines | Reason                          |
| ------------------------------------------------------ | ----- | ------------------------------- |
| `packages/opencode/src/memory/semantic-recall.ts`      | 80    | Shim no longer needed           |
| `packages/opencode/test/memory/memory-core-v3.test.ts` | 380   | 16/17 tests redundant per audit |

### Modify — production code

| Path                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/memory/fts5-backend.ts` | (a) Remove JSDoc reference to shim. (b) Inline `indexSync` body into `async index`. (c) Inline `searchSync` body into `async search`. (d) Delete `indexSync` and `searchSync` methods. (e) Keep `recent`, `get`, `remove` as-is. (f) Keep exported `format` function as-is.                                                                                                                                                                                      |
| `packages/opencode/src/memory/provider.ts`     | (a) Remove `import { SemanticRecall }`. (b) Import `format` from `./fts5-backend`. (c) Line 138: `SemanticRecall.format(artifacts, rBudget)` → `format(artifacts, rBudget)`. (d) Lines 199–205: rewrite `searchArtifacts` and `indexArtifact` as `async` that route through `getBackend()` (the existing `HybridBackend` singleton).                                                                                                                             |
| `packages/opencode/src/memory/index.ts`        | Remove `export { SemanticRecall } from "./semantic-recall"` (line 22) and its deprecation JSDoc.                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/opencode/src/memory/contracts.ts`    | Update `MemoryProvider` interface: `searchArtifacts` → `Promise<MemoryArtifact[]>`, `indexArtifact` → `Promise<string>`.                                                                                                                                                                                                                                                                                                                                         |
| `packages/opencode/src/session/prompt.ts`      | (a) Convert `indexSessionArtifacts` from `(sessionID) => void` to `async (sessionID) => Promise<void>`. (b) Inside: `await Memory.indexArtifact(...)` wrapped in its own `try/catch` that calls `log.warn` on rejection (Mastra-style — see D1b). (c) At line 1958, caller becomes `yield* Effect.promise(() => indexSessionArtifacts(sessionID))`. (d) Keep the outer `try/catch` at lines 1957–1961 as defense-in-depth for sync throws from title derivation. |
| `packages/opencode/src/dream/index.ts`         | Convert `persistConsolidation` from `(...) => void` to `async (...) => Promise<void>`. Inside: `await Memory.indexArtifact(...)` wrapped in the existing `try/catch` that already calls `log.warn` on rejection. No other structural change.                                                                                                                                                                                                                     |
| `packages/opencode/src/dream/daemon.ts`        | Line 141: add `await` before `AutoDream.persistConsolidation(...)`. Already inside `async` function with outer `try/catch (captureErr)`, so no other changes.                                                                                                                                                                                                                                                                                                    |

### Modify — tests (per audit SPLIT verdicts)

#### `memory-core.test.ts` — SPLIT

- **Delete** tests (redundant with new FTS5/hybrid tests):
  - L80 FTS5 vtable smoke
  - L196 FTS5 keyword search
  - L256 topic_key upsert (basic)
  - L372 index+get round-trip
  - L394 soft delete
- **Migrate** to `FTS5Backend`:
  - L157 artifact scope filter
  - L230 FTS5 special characters (unique sanitizer coverage)
  - L297 different topic_keys (only negative case)
  - L329 hash dedupe 15-min window (unique)
  - L424 `format()` budget (unique)
  - L574 buildContext recall (only the `.index()` prep call)
- **Keep untouched**: all WM / Handoff / migration / `<private>` / `clearScope` / provider tests.

#### `memory-core-v2.test.ts` — SPLIT

- **Delete**: L181 (redundant FTS), L488 (regression duplicate), L481, L507, L521 (all pure regression), L204 (obsolete historical guard), L414 (trivial smoke).
- **Migrate** to `FTS5Backend`: L227 (`recent()` fallback), L332 (`recent()` DESC order), L373 (`recent()` scope filter), L565 (`format()` 800-char preview).
- **Keep untouched**: L116, L142, L156 (OM atomicity), L256, L267, L283 (SystemPrompt wrap), L298, L308, L314 (tool), L419, L440, L466 (Dream integration).

#### `memory-core-v3.test.ts` — DELETE ENTIRELY

All 17 tests redundant or covered elsewhere per audit. Optional L180 and L268 folded into
surviving files if paranoid coverage is needed (audit recommendation: not needed).

#### `memory-core-final.test.ts` — SPLIT

- **Delete**: L116, L120 (duplicate of v2 L116), L189, L263, L318, L327, L344, L383, L388, L406, L416, L421, L452.
- **Keep untouched** (these don't import `SemanticRecall`): L145 (`addBufferSafe` merge), L202 (enriched fork JSON), L237 (provider handoff — await `Memory.indexArtifact` if needed), L288 (`<memory-recall>` tag), L336 (`wrapRecall` tag).
- **Update**: L267, L289 call-sites for `Memory.indexArtifact` → add `await`.

#### `memory-core-production.test.ts` — SPLIT

- **Delete**: L244, L265, L463, L664, L696, L713, L754, L789, L794, L825, L835, L840, L852, L878.
- **Migrate** to `FTS5Backend`: L288 (singular→plural prefix), L308 (special chars two-pass), L329 (scope filter in AND+OR), L362 (topic_key scope filter).
- **Keep untouched** (critical coverage):
  - All P-1 WM precedence tests (L126–L225)
  - L408, L438 (recency fallback via `buildContext`)
  - L478, L490, L503 (tool registry + agent scope)
  - L517, L532, L544 (agent/user WM in buildContext ancestry)
  - L558 (`ctx.blocks` metadata ordering — only test for this API)
  - L608 (global_pattern dormancy)
  - L639, L671 (user memory permission gate — security-critical)
  - L737 (WM guidance in hot path)
  - L763, L768 (flag removal guards)
  - L777 (`DEFAULT_USER_SCOPE_ID`)

### Modify — docs (active only; historical specs untouched)

| Path                                                                    | Change                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `README.md` L165, L184, L188                                            | `Memory.indexArtifact()` (now async) / remove `SemanticRecall.search()` reference |
| `docs/feature-catalog.md` L30, L73                                      | Rewrite "Semantic recall" entry to reference `HybridBackend`                      |
| `docs/autodream-architecture.md` L257, L267, L268, L277, L288           | Update data flow description                                                      |
| `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md` L416–432, L673, L1468, L1642 | Update code snippets and diagram to async `HybridBackend` path                    |
| All `docs/LIGHTCODE_MEMORY_CORE_V1/V2/V3_*.md`                          | **No changes.** These are historical specs.                                       |
| `docs/SUPERSEDED.md` L40, L77                                           | Update the "Superseded by" pointer if it references `SemanticRecall` as current   |

## Data Flow Comparison

### Old (buggy) indexing path

```
session loop ends
  → indexSessionArtifacts (sync, inside Effect.gen try/catch)
  → Memory.indexArtifact (sync, on provider)
  → SemanticRecall.index (sync, namespace)
  → FTS5Backend.indexSync (sync, class method)
  → SQLite INSERT to memory_artifacts + memory_artifacts_fts

❌ memory_artifacts_vec never populated.
❌ dream/index.ts same story.
❌ buildContext reads via HybridBackend, so SEMANTIC RECALL QUERIES RETURN NOTHING from the embedding side when the embedder is configured, because no vectors were ever written.
```

### New (correct) indexing path

```
session loop ends (user already has assistant message)
  → yield* Effect.promise(() => indexSessionArtifacts(sessionID))
  → async indexSessionArtifacts
    → try { await Memory.indexArtifact(...) }
      catch (err) { log.warn(...) }   // Mastra-style awaited + logged
  → HybridBackend.index (async, singleton)
    ├─ embedder available → EmbeddingBackend.index → fts5.index + embed + vec upsert
    └─ no embedder        → fts5.index only
  → memory_artifacts + memory_artifacts_fts (+ memory_artifacts_vec when embedder present)
  → session cleanup proceeds (activeContexts.delete, etc.)

✅ Embeddings written before cleanup — no race.
✅ buildContext reads from the same HybridBackend singleton and now gets real vector results on subsequent queries.
✅ Errors logged, not swallowed.
```

## Risks and Mitigations

| Risk                                                                               | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hidden caller of `SemanticRecall` outside `src/` and `test/`                       | Low        | Medium | grep across entire repo before deletion; audit already shows only `docs/` references and those are documentation, not imports                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Production sync caller of `Memory.indexArtifact` we didn't find                    | Low        | High   | Already greped `src/` and found only 2 callers, both in `try/catch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Test migration introduces async/await misuse                                       | Medium     | Low    | Mechanical rewrite per pattern in D5; bun test reports unawaited promises                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Awaited embedding blocks session-loop exit and delays cleanup                      | Medium     | Low    | Embedder is a singleton preloaded on first `buildContext`. Embedding a single session-end observation is ~milliseconds (fastembed 384-dim on local CPU). Mastra validates this exact pattern in production. User already has the response; we're only delaying internal cleanup by a few ms. Much better than fire-and-forget races with cleanup.                                                                                                                                                                                                                                                      |
| Embedder cold-start on first session-end if never queried before                   | Low        | Medium | Possible but rare — `Memory.buildContext()` runs at session START, which initializes the embedder singleton before any indexing happens. Unless a session closes without ever calling `buildContext` (not a realistic flow), the embedder is already warm.                                                                                                                                                                                                                                                                                                                                             |
| Embedder failure blocks indexing entirely                                          | Low        | Low    | **Verified against source**: `EmbeddingBackend.index()` calls `fts5.index()` FIRST (line 47), THEN calls `embedder.embed()` (line 51). FTS5 write is already committed when embed runs. If embed throws, the artifact is in `memory_artifacts` + FTS5 but missing its vector — acceptable partial success. The outer `try/catch` + `log.warn` in `indexSessionArtifacts` / `persistConsolidation` catches the throw so the session completes normally. **Consider adding a defensive try/catch around the embed call in `EmbeddingBackend.index()` as a follow-up**, but not required for this change. |
| Deleting `memory-core-v3.test.ts` removes a test we actually need                  | Low        | Low    | Audit shows 16/17 redundant. The one marginal-value test (`observeSafe removed`) is an obsolete API-surface guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Docs drift creates confusion                                                       | Low        | Low    | Update active docs in this change; historical specs explicitly left alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Renaming `Memory.indexArtifact` to async triggers `MemoryProvider` interface drift | Low        | Medium | Interface updated in same commit; type-check will catch any miss                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Rollback

Single commit for the whole change. Revert = full rollback. The shim file, sync `indexSync`/`searchSync`
methods, and the sync `Memory.indexArtifact`/`searchArtifacts` signatures all come back in one
`git revert`.

## Testing Strategy

No new tests. All work is:

1. Delete `memory-core-v3.test.ts`.
2. Delete / migrate tests in the other 4 files per audit SPLIT.
3. Existing Phase 4 tests (`fts5-backend.test.ts`, `hybrid-backend.test.ts`, etc.) already cover
   the underlying mechanics.
4. Run full test suite after changes:
   ```
   cd packages/opencode
   bun test test/memory/
   bun run test:vec
   ```

## Order of Operations (implementation plan)

Strict order to keep the tree compilable between steps. The user's rule says **never build or run tests
mid-work**, but keeping a logical order still matters for the final diff readability.

1. **`contracts.ts`**: update `MemoryProvider` interface to async.
2. **`fts5-backend.ts`**: inline sync bodies into async methods, delete `indexSync`/`searchSync`, remove JSDoc shim ref.
3. **`provider.ts`**: remove `SemanticRecall` import, import `format` from `fts5-backend`, rewrite `searchArtifacts` and `indexArtifact` as async using `getBackend()`.
4. **`session/prompt.ts`**: convert `indexSessionArtifacts` to async, await inside its own try/catch with `log.warn`, update caller at line 1958 to `yield* Effect.promise(...)`.
5. **`dream/index.ts`**: convert `persistConsolidation` to async, await inside existing try/catch.
6. **`dream/daemon.ts`**: add `await` before `AutoDream.persistConsolidation(...)` at line 141.
7. **`memory/index.ts`**: remove `SemanticRecall` export line.
8. **Delete `memory/semantic-recall.ts`**.
9. **Delete `test/memory/memory-core-v3.test.ts`**.
10. **Migrate / SPLIT tests** in: `memory-core.test.ts`, `memory-core-v2.test.ts`, `memory-core-final.test.ts`, `memory-core-production.test.ts`.
11. **Update active docs** (`README.md`, `docs/feature-catalog.md`, `docs/autodream-architecture.md`, `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`, `docs/SUPERSEDED.md`).
12. **Final grep sanity**: `rg SemanticRecall packages/opencode/src packages/opencode/test` should return zero results.

## Open Questions

None. Audit + Mastra reference closed all of them:

- ✔️ Are there hidden callers? No. Only `provider.ts`, `semantic-recall.ts`, `fts5-backend.ts` JSDoc.
- ✔️ Can we go async? Yes. Both production callers are in `try/catch` blocks that are easy to convert.
- ✔️ Fire-and-forget or awaited? **Awaited, Mastra-style.** Validated against Mastra's `SemanticRecall` processor source: they await `processOutputResult` in `runner.ts` after the stream completes. Same phase as `indexSessionArtifacts`.
- ✔️ Does awaiting block the user? No. `indexSessionArtifacts` runs at session loop exit, after the user already has their assistant message. We only delay internal cleanup by a few ms.
- ✔️ What happens if the embedder fails? Verified against `EmbeddingBackend.index()` source: FTS5 write commits first, embed runs second. On embed failure, artifact is persisted in FTS5 but missing its vector — partial success. Outer `try/catch` logs the warning.
- ✔️ Can we delete `memory-core-v3.test.ts` outright? Yes. 16/17 redundant.
- ✔️ Do we lose test coverage? No — SPLIT preserves WM/permission/block-ordering/OM/Dream/tool tests.
- ✔️ Does `HybridBackend.index()` work when embedder is null? Yes — already handles that path via `FTS5Backend.index` fallback.
