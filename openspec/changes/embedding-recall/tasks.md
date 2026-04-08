# Tasks: Embedding Recall

## Phase 1: Foundation

- [x] 1.1 Add `sqlite-vec`, `fastembed`, `lru-cache`, and `xxhash-wasm` in `packages/opencode/package.json`, then refresh the Bun lockfile.
- [x] 1.2 Update `packages/opencode/src/storage/db.bun.ts` to set the macOS custom SQLite path, enable extensions, and load `sqlite-vec` on startup.
- [x] 1.3 Extend `packages/opencode/src/config/config.ts` with `experimental.memory.embedder`, and add `EmbedderConfig`, `EmbedderBackend`, and `RecallBackend` in `packages/opencode/src/memory/contracts.ts`.
- [x] 1.4 Create `packages/opencode/migration/<timestamp>_embedding-recall/migration.sql` with raw vec0 DDL for `memory_artifacts_vec` and `memory_session_vectors`; mirror any runtime table guards in `packages/opencode/src/memory/schema.sql.ts`.

## Phase 2: Core Backends

- [x] 2.1 Extract the current FTS5 logic into `packages/opencode/src/memory/fts5-backend.ts`, then keep `packages/opencode/src/memory/semantic-recall.ts` as a compatibility export.
- [x] 2.2 Add `packages/opencode/src/memory/embedding-cache.ts` and `packages/opencode/src/memory/embedder.ts` for shared xxhash/LRU caching and embedder selection.
- [x] 2.3 Implement `packages/opencode/src/memory/embedding-backend.ts` to embed content and upsert/search `memory_artifacts_vec`.
- [x] 2.4 Implement `packages/opencode/src/memory/hybrid-backend.ts` to run FTS5 + embedding search in parallel and merge results with RRF.
- [x] 2.5 Add `packages/opencode/src/memory/session-memory.ts` for per-session append, recall, and clear behavior against `memory_session_vectors`.

## Phase 3: Integration

- [x] 3.1 Wire `packages/opencode/src/memory/provider.ts` so `buildContext()` uses `SessionMemory` plus `HybridBackend`.
- [x] 3.2 Update `packages/opencode/src/memory/index.ts` and `packages/opencode/src/memory/semantic-recall.ts` exports to expose the new API and mark legacy entrypoints deprecated.

## Phase 4: Testing (RED/GREEN/REFACTOR)

- [x] 4.1 RED/GREEN: Refactor `packages/opencode/test/session/recall.test.ts` for `FTS5Backend` parity: two-pass AND/OR, `topic_key`, soft delete, and dedup.
- [x] 4.2 Add `packages/opencode/test/memory-vec/embedding-backend.test.ts` for embed + upsert/search on a temp-file DB.
- [x] 4.3 Add `packages/opencode/test/memory/hybrid-backend.test.ts` for RRF ordering, dedupe by `artifact_id`, and FTS5-only fallback.
- [x] 4.4 Add `packages/opencode/test/memory-vec/session-memory.test.ts` for the 50-token threshold, skip-without-embedder, top-5 recall, score filter, and cleanup.
- [x] 4.5 Add `packages/opencode/test/session/build-context.test.ts` to cover `buildContext()` sessionRecall + recall sections end to end.

## Phase 5: Cleanup

- [x] 5.1 Update JSDoc and deprecation notes across `packages/opencode/src/memory/*.ts` to steer callers away from `semantic-recall.ts` and document cache/embedder behavior.
