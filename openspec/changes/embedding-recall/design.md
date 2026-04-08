# Design: Embedding Recall

## Technical Approach

Introduce a `RecallBackend` interface and split `SemanticRecall` (today FTS5-only) into `FTS5Backend` (lexical) and `EmbeddingBackend` (vector via sqlite-vec), composed by a `HybridBackend` that fuses ranks with Reciprocal Rank Fusion. Add a per-session ephemeral vector layer (`SessionMemory`) consulted every turn. `Memory.buildContext()` orchestrates: WorkingMemory + OM + SessionMemory + RecallBackend. Embeddings come from a singleton `embedder` factory (fastembed → AI SDK fallback). All new modules follow the namespace pattern, Effect where surrounding code already uses it, Drizzle for non-vector tables.

## Architecture Decisions

| Decision             | Choice                                                                          | Rejected                        | Rationale                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Vector store         | sqlite-vec on existing SQLite file                                              | LanceDB / Qdrant / pgvector     | Zero infra; reuses `db.bun.ts`; same tx scope as artifacts.                                                     |
| macOS extension load | `setCustomSQLite("/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib")` before open | Patch Bun's SQLite              | Bun's macOS build lacks `enableExtensions`; Linux is fine.                                                      |
| Dimension            | Fixed **384** (BGE-Small)                                                       | Per-model tables                | vec virtual tables hard-code dim. Model switch drops+recreates only the vec table (FTS5 + artifacts untouched). |
| Embedder             | fastembed first, AI SDK `embed()` fallback                                      | AI SDK only                     | Local, no network, no token cost. Fallback covers ONNX gaps in Bun.                                             |
| Fusion               | RRF, k=60, dedupe by `artifact_id`                                              | Weighted sum / learned reranker | Standard, parameter-free, no training data.                                                                     |
| Cache                | Singleton `EmbeddingCache` namespace, lru-cache(1000), key=xxhash32(content)    | Per-backend caches              | Shared across `SessionMemory` + `EmbeddingBackend`; matches `Database` pattern.                                 |
| Vec DDL              | Raw SQL in migration                                                            | Drizzle schema                  | Drizzle has no virtual-table support.                                                                           |
| Tests                | Temp file DB                                                                    | Mock sqlite-vec                 | `enableExtensions: true` rejects `:memory:`.                                                                    |

## Data Flow

```
buildContext(opts)
  ├── WorkingMemory.getForScopes(scopes)
  ├── OM.get(scopes)
  ├── SessionMemory.recall(sid, query)        ─┐
  └── RecallBackend.search(query, scopes)      │  → MemoryContext
        HybridBackend                          │
        ├── FTS5Backend.search()  ──┐          │
        └── EmbeddingBackend.search()─┴─ RRF ──┘
                                  ▲
                                  └── embedder() → EmbeddingCache → fastembed | AI SDK
```

Indexing: `Memory.indexArtifact(a)` → `FTS5Backend.index(a)` + `EmbeddingBackend.index(a)` (embed → upsert `memory_artifacts_vec`). `SessionMemory.append(sid, msg)` chunks, embeds, upserts `memory_session_vectors`; cleared on session close.

## File Changes

| File                              | Action | Description                                                                           |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `src/memory/embedder.ts`          | Create | Singleton factory: fastembed → AI SDK fallback; reads `experimental.memory.embedder`. |
| `src/memory/embedding-cache.ts`   | Create | Shared LRU(1000) keyed by xxhash32.                                                   |
| `src/memory/embedding-backend.ts` | Create | `EmbeddingBackend` namespace; wraps `memory_artifacts_vec`.                           |
| `src/memory/hybrid-backend.ts`    | Create | `HybridBackend` namespace; RRF over FTS5 + Embedding.                                 |
| `src/memory/session-memory.ts`    | Create | `SessionMemory` namespace; ephemeral per-session vectors.                             |
| `src/memory/fts5-backend.ts`      | Create | Refactored `SemanticRecall` body; implements `RecallBackend`.                         |
| `src/memory/contracts.ts`         | Modify | Add `RecallBackend`, `EmbedderConfig`, `EmbedderBackend`.                             |
| `src/memory/provider.ts`          | Modify | `buildContext()` calls `HybridBackend` + `SessionMemory`.                             |
| `src/memory/semantic-recall.ts`   | Modify | Re-export from `fts5-backend.ts`; deprecation notice.                                 |
| `src/memory/index.ts`             | Modify | Export new public types.                                                              |
| `src/memory/schema.sql.ts`        | Modify | Append raw DDL for vec tables; drop-on-dim-mismatch guard.                            |
| `src/storage/db.bun.ts`           | Modify | macOS custom SQLite, `enableExtensions: true`, `sqliteVec.load`.                      |
| `src/config/config.ts`            | Modify | Add `experimental.memory.embedder` (zod).                                             |
| `package.json`                    | Modify | Add `sqlite-vec`, `fastembed`, `lru-cache`, `xxhash-wasm`.                            |

## Interfaces / Contracts

```ts
export interface RecallBackend {
  search(query: string, scopes: Scope[], limit: number): Promise<Artifact[]>
  index(artifact: Artifact): Promise<void>
  recent(scopes: Scope[], limit: number): Promise<Artifact[]>
}

export type EmbedderBackend = "fastembed" | "ai-sdk"
export type EmbedderConfig = { backend: EmbedderBackend; model: string; dim: 384 }

export namespace SessionMemory {
  export function append(sid: string, msg: ModelMessage): Promise<void>
  export function recall(sid: string, query: string, k?: number): Promise<string[]>
  export function clear(sid: string): Promise<void>
}
```

## Testing Strategy

| Layer       | What               | Approach                                                                |
| ----------- | ------------------ | ----------------------------------------------------------------------- |
| Unit        | `FTS5Backend`      | Migrate existing `SemanticRecall` tests verbatim.                       |
| Unit        | `EmbeddingBackend` | Mock embedder → deterministic vectors; real sqlite-vec on temp file DB. |
| Unit        | `HybridBackend`    | Known FTS5 + embedding lists; assert RRF order + dedupe.                |
| Unit        | `SessionMemory`    | Temp file DB; append → recall → clear lifecycle.                        |
| Unit        | `embedder`         | Mock fastembed; verify config parsing + AI SDK fallback.                |
| Integration | `buildContext`     | Temp file DB end-to-end; assert sessionRecall + recall sections.        |

Run from `packages/opencode` with `bun test --timeout 30000`. No `:memory:` (sqlite-vec limitation).

## Migration / Rollout

Schema migration runs at `db.bun.ts` init: create vec tables if absent; if existing dim ≠ configured dim, `DROP` and recreate (vector data only — artifacts + FTS5 untouched, re-embed lazily on next index). Implicit opt-in via `experimental.memory.embedder`; if unset, `HybridBackend` degrades to FTS5-only and vec tables stay empty. No breaking change to `Memory.buildContext()` callers.

## Open Questions

None — all decisions verified at runtime per the research notes.
