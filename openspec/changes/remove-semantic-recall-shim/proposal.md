# Proposal — Remove `SemanticRecall` Shim & Fix Silent Embedding Bug

## Intent

Delete the `SemanticRecall` compatibility namespace that survived the `embedding-recall` change,
and fix the silent bug where `Memory.indexArtifact()` still bypasses `HybridBackend` so production
writes never generate embeddings.

## Why Now

The `embedding-recall` change shipped a clean `HybridBackend` (FTS5 + embeddings via RRF) but
`provider.ts` was only half-migrated: **reads** go through `HybridBackend`, **writes** still go
through `SemanticRecall.index → FTS5Backend.indexSync`, which never touches the embedding pipeline.

As long as `Memory.indexArtifact()` is called — and it is, from both `session/prompt.ts`
(session-end auto-indexing) and `dream/index.ts` (consolidation) — **the embedding side of the
vec table stays empty**. Queries from `Memory.buildContext()` then degrade silently to FTS5-only
RRF even when the user has a working embedder configured.

This is a production bug, not a cosmetic v3 deprecation.

## Scope

### In scope

- Delete `packages/opencode/src/memory/semantic-recall.ts` entirely.
- Make `Memory.indexArtifact()` and `Memory.searchArtifacts()` async and route them through the
  existing `HybridBackend` singleton (`getBackend()` in `provider.ts`).
- Inline `FTS5Backend.indexSync` / `searchSync` into the async `index` / `search` methods and
  delete the sync variants.
- Update both production callers (`session/prompt.ts`, `dream/index.ts`) to **await** the
  now-async call inside their existing `try/catch` blocks (Mastra-style awaited post-turn
  indexing, NOT fire-and-forget — see `design.md` D1b). Also update `dream/daemon.ts` to
  `await` `persistConsolidation`.
- Update `MemoryProvider` interface in `contracts.ts` to reflect async signatures.
- Audit and migrate legacy tests in `test/memory/memory-core*.test.ts`:
  - Delete `memory-core-v3.test.ts` entirely (16/17 tests redundant per audit).
  - SPLIT the other 4 files: delete redundant tests, migrate `SemanticRecall.*` calls to
    `new FTS5Backend()` for unique coverage, keep non-shim tests untouched.
- Remove `SemanticRecall` export from `packages/opencode/src/memory/index.ts`.
- Update active docs (`README.md`, `docs/feature-catalog.md`, `docs/autodream-architecture.md`,
  `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`, `docs/SUPERSEDED.md`) to describe the async
  `HybridBackend` indexing path.

### Out of scope

- Changing the shape of `Memory.buildContext()`, `MemoryContext`, or `PromptBlock`.
- Touching the historical `docs/LIGHTCODE_MEMORY_CORE_V1/V2/V3_*.md` specs.
- Adding new embedding providers, new backends, or new tests.
- Archiving the `embedding-recall` change (separate step).

## Approach

Single atomic commit. Order:

1. Update the `MemoryProvider` interface contract to async.
2. Update `FTS5Backend`: inline sync bodies, delete `*Sync` methods.
3. Update `provider.ts`: remove `SemanticRecall` import, wire `searchArtifacts` / `indexArtifact`
   through `getBackend()`.
4. Convert `indexSessionArtifacts` in `session/prompt.ts` to async with awaited `Memory.indexArtifact`
   inside its own `try/catch` + `log.warn`. Update caller at line 1958 to `yield* Effect.promise(...)`.
5. Convert `persistConsolidation` in `dream/index.ts` to async with awaited `Memory.indexArtifact`
   inside its existing `try/catch`.
6. Add `await` before `AutoDream.persistConsolidation(...)` at `dream/daemon.ts:141`.
7. Remove the `SemanticRecall` export from `memory/index.ts`.
8. Delete `semantic-recall.ts`.
9. Delete `memory-core-v3.test.ts`.
10. SPLIT and migrate tests in the other 4 legacy files.
11. Update active docs.
12. Grep-sanity: `rg SemanticRecall packages/opencode/src packages/opencode/test` → 0 results.

See `design.md` for the full investigation, decision log, and file-by-file change list.

## Success Criteria

- `rg SemanticRecall packages/opencode/src packages/opencode/test` returns zero matches.
- `rg indexSync|searchSync packages/opencode/src` returns zero matches.
- `Memory.indexArtifact()` and `Memory.searchArtifacts()` are `async` and route through
  `HybridBackend`.
- `session/prompt.ts` and `dream/index.ts` compile and preserve fire-and-forget semantics.
- Test suite structure preserved: WM precedence, `ctx.blocks` ordering, user-memory permission
  gate, `addBufferSafe` merge, enriched fork JSON, `<memory-recall>` tag, recency fallback, FTS5
  sanitizer, hash dedupe, `format()` budget, `recent()` ordering — all still have coverage.
- Production indexing (session-end auto-index, dream consolidation) generates embeddings when
  an embedder is configured.

## Risks

- **Hidden sync caller of `Memory.indexArtifact`**: mitigated by full-repo grep. Only 2 callers
  exist, both in `try/catch` blocks trivial to convert.
- **Test coverage loss**: mitigated by audit-driven SPLIT, not wholesale deletion.
- **Awaited embedding delays session cleanup**: mitigated by the fact that `indexSessionArtifacts`
  runs AFTER the user already has their assistant message. We only block internal cleanup by a
  few ms (fastembed 384-dim on local CPU). Mastra validates this exact pattern in production.
  Tradeoff: observability and no race conditions >>> a few ms of cleanup delay.
- **Embedder failure blocks indexing**: mitigated because `EmbeddingBackend.index()` writes to
  FTS5 FIRST and embeds second, so an embed failure leaves the artifact in FTS5 with no vector
  (partial success). The outer `try/catch` + `log.warn` catches and logs.

## Rollback

Single `git revert` restores the shim, the sync methods, and the sync `Memory.indexArtifact`
signature in one step.
