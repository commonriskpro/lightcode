# Tasks: high-context-prompt-cache

## T-1 — Add prompt block metadata to memory context

- [x] **T-1.1** `packages/opencode/src/memory/contracts.ts` — add prompt-block types (`PromptBlockKey`, `PromptBlock`) and extend `MemoryContext` with block metadata while preserving compatibility for current callers.
- [x] **T-1.2** `packages/opencode/src/memory/provider.ts` — make `Memory.buildContext()` emit deterministic block metadata with `hash`, `tokens`, and `stable` flags for working memory, observations, and semantic recall.
- [x] **T-1.3** `packages/opencode/src/memory/provider.ts` — keep `Memory.buildContext()` as the only composition path; do not introduce a second prompt-memory assembler.

---

## T-2 — Split observations into stable and volatile prompt layers

- [x] **T-2.1** `packages/opencode/src/session/system.ts` — extract helpers that render stable observation content separately from volatile continuation/task hints.
- [x] **T-2.2** `packages/opencode/src/memory/provider.ts` — expose `observations_stable` and `observations_live` as distinct blocks in the returned memory context.
- [x] **T-2.3** `packages/opencode/src/session/prompt.ts` — consume the split observation blocks without changing current observation semantics or dropping any high-context information.

---

## T-3 — Make LLM prompt assembly deterministic and block-aware

- [x] **T-3.1** `packages/opencode/src/session/llm.ts` — replace raw positional `system.splice(...)` logic with deterministic block assembly that preserves stable ordering.
- [x] **T-3.2** `packages/opencode/src/session/llm.ts` — keep stable blocks ordered before volatile ones: base prompt, agent prompt, stable instructions, working memory, stable observations, semantic recall, volatile observation/live hints, volatile model/date.
- [x] **T-3.3** `packages/opencode/src/session/llm.ts` — ensure optional block absence does not reorder remaining stable blocks.

---

## T-4 — Add provider-aware prompt cache metadata

- [x] **T-4.1** `packages/opencode/src/provider/transform.ts` — add a helper that maps stable prompt blocks to provider-specific cache metadata without creating a parallel provider path.
- [x] **T-4.2** `packages/opencode/src/session/llm.ts` — attach prompt cache metadata to stable prompt blocks for Anthropic requests, not just the final tool definition.
- [x] **T-4.3** `packages/opencode/src/session/llm.ts` — preserve existing tool cache behavior while extending cache metadata to stable prompt content.
- [x] **T-4.4** `packages/opencode/src/provider/transform.ts` — no-op cleanly for providers that do not support prompt caching.

---

## T-5 — Reuse semantic recall for same-topic follow-ups

- [x] **T-5.1** `packages/opencode/src/session/prompt.ts` — keep lightweight session-local recall state (query identity, recall hash, topic marker) for reuse decisions.
- [x] **T-5.2** `packages/opencode/src/memory/query-reuse.ts` — reuse semantic recall on short same-topic follow-ups when the prior recall is still valid.
- [x] **T-5.3** `packages/opencode/src/memory/query-reuse.ts` — force recall refresh on topic shift, explicit exact-history requests, or long new queries.

---

## T-6 — Add per-layer prompt/cache instrumentation

- [x] **T-6.1** `packages/opencode/src/session/llm.ts` — record per-layer token counts for header, working memory, stable observations, volatile observations, recall, and live message tail via `LLM.profile()`.
- [x] **T-6.2** `packages/opencode/src/session/llm.ts` — emit per-layer hashes in structured log diagnostics and persist to `PromptProfile` in-memory store.
- [x] **T-6.3** `packages/opencode/src/session/processor.ts` — preserve provider cache read/write counters alongside those diagnostics when the provider returns them.

---

## T-7 — Tests for cache-aware high-context behavior

- [x] **T-7.1** `packages/opencode/test/memory/memory-core-production.test.ts` — `Memory.buildContext()` returns deterministic block hashes/tokens/stability metadata.
- [x] **T-7.2** `packages/opencode/test/session/llm.test.ts` — stable block order is deterministic across equivalent turns.
- [x] **T-7.3** `packages/opencode/test/session/observer.test.ts` — volatile observation hint changes do not affect stable observation hash.
- [x] **T-7.4** `packages/opencode/test/provider/transform.test.ts` — Anthropic requests include prompt cache metadata on stable prompt blocks; breakpoint count stays ≤ 3 message slots (+ tool BP1).
- [x] **T-7.5** `packages/opencode/test/memory/query-reuse.test.ts` — semantic recall reuse on short same-topic follow-ups and refresh on topic shift.

---

## T-8 — Verification

- [x] **T-8.1** `bun typecheck` from `packages/opencode` — 0 errors
- [x] **T-8.2** Run focused prompt/memory/provider tests from `packages/opencode` — 0 failures (192 pass)
- [x] **T-8.3** Verify no memory budgets were reduced as part of the change

---

## T-9 — Post-implementation hardening (2026-04-06)

- [x] **T-9.1** Tightened Anthropic breakpoint planner to respect the current 4-slot max; merged stable head and OM core for Anthropic requests to avoid over-annotation.
- [x] **T-9.2** Added `PromptProfile` in-memory store (`src/session/prompt-profile.ts`) and wired `recallReused` flag end-to-end through `loadRuntimeMemory → LLM.stream → PromptProfile.set`.
- [x] **T-9.3** Added `GET /experimental/prompt-profile?sessionID=...` endpoint for external tooling access.
- [x] **T-9.4** Added `/cache-debug` TUI slash command (`dialog-cache-debug.tsx`) with live per-layer tokens, hashes, cache read/write counters, and recall reuse signal. Aliases: `/prompt-profile`, `/cachedbg`.
