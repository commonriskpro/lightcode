# Tasks — Remove `SemanticRecall` Shim

## Phase 1 — Interface & Backend

- [ ] 1.1 Update `packages/opencode/src/memory/contracts.ts`: change `MemoryProvider.searchArtifacts` return type to `Promise<MemoryArtifact[]>` and `MemoryProvider.indexArtifact` return type to `Promise<string>`.
- [ ] 1.2 Update `packages/opencode/src/memory/fts5-backend.ts`:
  - Remove the "`searchSync()` and `indexSync()` are compatibility shims…" note from the top JSDoc.
  - Inline the body of `indexSync` into `async index`. Delete `indexSync`.
  - Inline the body of `searchSync` into `async search`. Delete `searchSync`.
  - Keep `recent`, `get`, `remove`, and exported `format` unchanged.

## Phase 2 — Provider Wiring

- [ ] 2.1 Update `packages/opencode/src/memory/provider.ts`:
  - Remove `import { SemanticRecall } from "./semantic-recall"`.
  - Import `format` from `./fts5-backend` alongside the existing `FTS5Backend` import.
  - Line 138: replace `SemanticRecall.format(artifacts, rBudget)` with `format(artifacts, rBudget)`.
  - Rewrite `Memory.searchArtifacts` as `async` and route through `(await getBackend()).search(query, scopes, limit)`.
  - Rewrite `Memory.indexArtifact` as `async` and route through `(await getBackend()).index(artifact)`.

## Phase 3 — Production Callers (Mastra-style awaited, NOT fire-and-forget)

- [ ] 3.1 Update `packages/opencode/src/session/prompt.ts`:
  - Convert `indexSessionArtifacts` signature from `(sessionID: SessionID): void` to `async (sessionID: SessionID): Promise<void>`.
  - Inside the function body, wrap the `Memory.indexArtifact(...)` call in its own `try/catch`:
    ```ts
    try {
      await Memory.indexArtifact({
        /* existing fields */
      })
    } catch (err) {
      log.warn("session-end artifact indexing failed", {
        sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    ```
  - At the caller (line 1958), change `indexSessionArtifacts(sessionID)` to `yield* Effect.promise(() => indexSessionArtifacts(sessionID))`.
  - Keep the outer `try/catch` at lines 1957–1961 — it still catches any sync throws from title derivation (`Instance.project.id` access, etc.).
  - `log` is already available via `const log = Log.create({ service: "session.prompt" })` at line 75.
- [ ] 3.2 Update `packages/opencode/src/dream/index.ts`:
  - Convert `persistConsolidation` signature from `(...args): void` to `async (...args): Promise<void>`.
  - Inside the existing `try/catch`, change `Memory.indexArtifact({ ... })` to `await Memory.indexArtifact({ ... })`.
  - The existing `log.info` success line and `log.warn` error line both stay as-is.
- [ ] 3.3 Update `packages/opencode/src/dream/daemon.ts`:
  - Line 141: add `await` before `AutoDream.persistConsolidation(...)`.
  - Already inside `async` function with outer `try/catch (captureErr)` at lines 150–154. No other structural change needed.

## Phase 4 — Delete Shim & Export

- [ ] 4.1 Update `packages/opencode/src/memory/index.ts`: remove line 22 (`export { SemanticRecall } from "./semantic-recall"`) and its `@deprecated` JSDoc comment.
- [ ] 4.2 Delete `packages/opencode/src/memory/semantic-recall.ts`.

## Phase 5 — Test Migration (SPLIT per audit)

- [ ] 5.1 Delete `packages/opencode/test/memory/memory-core-v3.test.ts` entirely.
- [ ] 5.2 `packages/opencode/test/memory/memory-core.test.ts` — SPLIT:
  - Delete: L80 (FTS5 vtable smoke), L196 (FTS5 keyword search), L256 (topic_key upsert basic), L372 (index+get), L394 (soft delete).
  - Migrate to `new FTS5Backend()` + `await`: L157 (scope filter), L230 (FTS5 special chars), L297 (different topic_keys), L329 (hash dedupe 15-min window), L424 (format budget), L574 (buildContext `.index()` prep call).
  - Keep untouched: all WM / Handoff / migration / `<private>` / `clearScope` / provider tests.
  - Remove `import { SemanticRecall }` once no tests reference it.
- [ ] 5.3 `packages/opencode/test/memory/memory-core-v2.test.ts` — SPLIT:
  - Delete: L181, L204, L414, L481, L488, L507, L521.
  - Migrate to `new FTS5Backend()` + `await`: L227 (`recent()` fallback), L332 (`recent()` DESC), L373 (`recent()` scope filter), L565 (`format()` 800-char preview).
  - Keep untouched: L116, L142, L156 (OM atomicity), L256, L267, L283 (SystemPrompt wrap), L298, L308, L314 (tool), L419, L440, L466 (Dream).
  - Remove `import { SemanticRecall }` once no tests reference it.
- [ ] 5.4 `packages/opencode/test/memory/memory-core-final.test.ts` — SPLIT:
  - Delete: L116, L120, L189, L263, L318, L327, L344, L383, L388, L406, L416, L421, L452.
  - Update `Memory.indexArtifact(...)` call-sites at L267 and L289 to `await Memory.indexArtifact(...)` (tests become async).
  - Keep untouched: L145, L202, L237, L288, L336.
  - Remove `import { SemanticRecall }` once no tests reference it.
- [ ] 5.5 `packages/opencode/test/memory/memory-core-production.test.ts` — SPLIT:
  - Delete: L244, L265, L463, L664, L696, L713, L754, L789, L794, L825, L835, L840, L852, L878.
  - Migrate to `new FTS5Backend()` + `await`: L288, L308, L329, L362.
  - Keep untouched: all P-1 WM precedence tests (L126–L225), L408, L438 (recency fallback), L478, L490, L503, L517, L532, L544, L558 (`ctx.blocks`), L608, L639, L671 (permission gate), L737, L763, L768, L777.
  - Remove `import { SemanticRecall }` once no tests reference it.

## Phase 6 — Docs

- [ ] 6.1 Update `README.md`: lines ~165, ~184, ~188 — replace the `SemanticRecall.search() → system[2]` data-flow line with a `HybridBackend` reference; mention that `Memory.indexArtifact()` is async.
- [ ] 6.2 Update `docs/feature-catalog.md`: line ~30 (Semantic recall entry) and ~73 (AutoDream persistence).
- [ ] 6.3 Update `docs/autodream-architecture.md`: lines ~257, ~267, ~268, ~277, ~288.
- [ ] 6.4 Update `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`: lines ~416–432 (code snippet), ~673 (namespace comment), ~1468 (example), ~1642 (diagram).
- [ ] 6.5 Update `docs/SUPERSEDED.md`: lines ~40 and ~77 — pointer still says `SemanticRecall`; change to `Memory.indexArtifact()` (async) + `HybridBackend`.
- [ ] 6.6 **Leave untouched**: `docs/LIGHTCODE_MEMORY_CORE_V1/V2/V3_*.md`, `docs/LIGHTCODE_MEMORY_PRODUCTION_*.md`, `docs/autodream-spec.md`, `docs/autodream-design.md`, `docs/autodream-engram-integration.md` — these are historical specs with existing superseded headers.

## Phase 7 — Final Sanity

- [ ] 7.1 Run `rg SemanticRecall packages/opencode/src packages/opencode/test` — must return zero results.
- [ ] 7.2 Run `rg 'indexSync|searchSync' packages/opencode/src` — must return zero results.
- [ ] 7.3 Run `rg 'import.*semantic-recall' packages/opencode` — must return zero results.
- [ ] 7.4 Confirm `packages/opencode/src/memory/semantic-recall.ts` does not exist.
- [ ] 7.5 Confirm `packages/opencode/test/memory/memory-core-v3.test.ts` does not exist.
