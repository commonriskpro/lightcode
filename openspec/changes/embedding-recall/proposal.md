# Proposal: embedding-recall

## Intent

Implement two embedding-based recall systems for lightcode's memory layer: an intra-session index and a cross-session hybrid backend (FTS5 + Embeddings). This solves FTS5 keyword matching failures on semantic queries (e.g., "login" vs "JWT authentication").

## Scope

### In Scope

- Add `sqlite-vec` for local vector storage.
- Use `fastembed` (BGE-Small-EN-v1.5) as the default zero-config embedder.
- Implement LRU embedding cache (xxhash).
- Create ephemeral intra-session vector index (`memory_session_vectors`).
- Add embedding index to existing `memory_artifacts` (cross-session).
- Implement Hybrid FTS5 + Embedding search using Reciprocal Rank Fusion (RRF).
- Fallback to pure FTS5 if embedder is unavailable.
- Add `experimental.memory.embedder` config support.

### Out of Scope

- Retroactive re-indexing of existing artifacts.
- Removing FTS5.
- External vector stores (Pinecone, pgvector).
- Mutex on `WorkingMemory.set()`.

## Capabilities

### New Capabilities

- `session-memory`: Indexes all messages of the current session with embeddings for intra-session semantic recall.
- `embedding-recall-backend`: Vector-based recall implementation using `sqlite-vec` and `fastembed`.
- `embedder-config`: Configuration for selecting embedder providers and models (`experimental.memory.embedder`).

### Modified Capabilities

- `semantic-recall`: Existing pure FTS5 backend gets wrapped as `FTS5Backend` and composed within the new hybrid backend.

## Approach

Leverage `sqlite-vec` for vector storage directly in the same SQLite database. Use `fastembed` for local embedding without external dependencies.
Introduce `session-memory.ts` for intra-session recall and `hybrid-backend.ts` for cross-session recall using RRF. The existing `RecallBackend` interface in `contracts.ts` handles the swap seamlessly. Fallback to `FTS5Backend` if `fastembed` isn't configured/available. Cache embeddings via an LRU xxhash cache to minimize re-embedding cost.

## Affected Areas

| Area                                                | Impact   | Description                                   |
| --------------------------------------------------- | -------- | --------------------------------------------- |
| `packages/opencode/src/memory/contracts.ts`         | Modified | Add `EmbedderConfig` type                     |
| `packages/opencode/src/memory/semantic-recall.ts`   | Modified | Becomes `FTS5Backend`                         |
| `packages/opencode/src/memory/provider.ts`          | Modified | Update `buildContext()` for backend selection |
| `packages/opencode/src/storage/db.bun.ts`           | Modified | Load `sqlite-vec` + `enableExtensions`        |
| `packages/opencode/src/config/config.ts`            | Modified | Add `experimental.memory.embedder`            |
| `packages/opencode/src/memory/embedding-backend.ts` | New      | `sqlite-vec` `RecallBackend` implementation   |
| `packages/opencode/src/memory/hybrid-backend.ts`    | New      | FTS5 + Embedding RRF composition              |
| `packages/opencode/src/memory/session-memory.ts`    | New      | Intra-session vector index                    |
| `packages/opencode/src/memory/embedding-cache.ts`   | New      | LRU xxhash cache                              |
| `packages/opencode/src/memory/embedder.ts`          | New      | Embedder factory                              |

## Risks

| Risk                                  | Likelihood | Mitigation                                                      |
| ------------------------------------- | ---------- | --------------------------------------------------------------- |
| `sqlite-vec` fails to load on some OS | Low        | Graceful fallback to pure FTS5                                  |
| High memory usage by `fastembed`      | Low        | Limit LRU cache (1000 entries) and use Small models             |
| Slow embedding                        | Medium     | Optimize with cache; async background processing where possible |

## Rollback Plan

Revert `packages/opencode/src/storage/db.bun.ts` to disable `sqlite-vec` loading. Since data schema additions are isolated and `Memory.buildContext()` falls back to FTS5, no data is lost.

## Dependencies

- `sqlite-vec`
- `fastembed`

## Success Criteria

- [ ] Without embedder config, system behaves identically (pure FTS5).
- [ ] With `fastembed`, cross-session recall successfully matches semantic queries (e.g., "login" finds "JWT").
- [ ] Intra-session recall returns relevant past messages.
- [ ] `sqlite-vec` loads on macOS (Homebrew) and Linux.
