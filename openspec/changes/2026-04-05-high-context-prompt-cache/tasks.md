# Tasks: high-context-prompt-cache

## T-1 — Add prompt block metadata to memory context

- [ ] **T-1.1** `packages/opencode/src/memory/contracts.ts` — add prompt-block types (`PromptBlockKey`, `PromptBlock`) and extend `MemoryContext` with block metadata while preserving compatibility for current callers.
- [ ] **T-1.2** `packages/opencode/src/memory/provider.ts` — make `Memory.buildContext()` emit deterministic block metadata with `hash`, `tokens`, and `stable` flags for working memory, observations, and semantic recall.
- [ ] **T-1.3** `packages/opencode/src/memory/provider.ts` — keep `Memory.buildContext()` as the only composition path; do not introduce a second prompt-memory assembler.

---

## T-2 — Split observations into stable and volatile prompt layers

- [ ] **T-2.1** `packages/opencode/src/session/system.ts` — extract helpers that render stable observation content separately from volatile continuation/task hints.
- [ ] **T-2.2** `packages/opencode/src/memory/provider.ts` — expose `observations_stable` and `observations_live` as distinct blocks in the returned memory context.
- [ ] **T-2.3** `packages/opencode/src/session/prompt.ts` — consume the split observation blocks without changing current observation semantics or dropping any high-context information.

---

## T-3 — Make LLM prompt assembly deterministic and block-aware

- [ ] **T-3.1** `packages/opencode/src/session/llm.ts` — replace raw positional `system.splice(...)` logic with deterministic block assembly that preserves stable ordering.
- [ ] **T-3.2** `packages/opencode/src/session/llm.ts` — keep stable blocks ordered before volatile ones: base prompt, agent prompt, stable instructions, working memory, stable observations, semantic recall, volatile observation/live hints, volatile model/date.
- [ ] **T-3.3** `packages/opencode/src/session/llm.ts` — ensure optional block absence does not reorder remaining stable blocks.

---

## T-4 — Add provider-aware prompt cache metadata

- [ ] **T-4.1** `packages/opencode/src/provider/transform.ts` — add a helper that maps stable prompt blocks to provider-specific cache metadata without creating a parallel provider path.
- [ ] **T-4.2** `packages/opencode/src/session/llm.ts` — attach prompt cache metadata to stable prompt blocks for Anthropic requests, not just the final tool definition.
- [ ] **T-4.3** `packages/opencode/src/session/llm.ts` — preserve existing tool cache behavior while extending cache metadata to stable prompt content.
- [ ] **T-4.4** `packages/opencode/src/provider/transform.ts` — no-op cleanly for providers that do not support prompt caching.

---

## T-5 — Reuse semantic recall for same-topic follow-ups

- [ ] **T-5.1** `packages/opencode/src/session/prompt.ts` — keep lightweight session-local recall state (query identity, recall hash, topic marker) for reuse decisions.
- [ ] **T-5.2** `packages/opencode/src/session/prompt.ts` or new helper — reuse semantic recall on short same-topic follow-ups when the prior recall is still valid.
- [ ] **T-5.3** `packages/opencode/src/session/prompt.ts` or new helper — force recall refresh on topic shift, explicit exact-history requests, or ambiguity.

---

## T-6 — Add per-layer prompt/cache instrumentation

- [ ] **T-6.1** `packages/opencode/src/session/llm.ts` — record per-layer token counts for header, working memory, stable observations, volatile observations, recall, and live message tail.
- [ ] **T-6.2** `packages/opencode/src/session/llm.ts` — emit per-layer hashes (`headerHash`, `wmHash`, `obsStableHash`, `obsLiveHash`, `recallHash`) in structured diagnostics.
- [ ] **T-6.3** `packages/opencode/src/session/llm.ts` — preserve provider cache read/write counters alongside those diagnostics when the provider returns them.

---

## T-7 — Tests for cache-aware high-context behavior

- [ ] **T-7.1** `packages/opencode/test/memory/...` — add tests that `Memory.buildContext()` returns deterministic block hashes/tokens/stability metadata.
- [ ] **T-7.2** `packages/opencode/test/session/...` — add tests proving stable block order is deterministic across equivalent turns.
- [ ] **T-7.3** `packages/opencode/test/session/...` — add tests showing volatile observation hint changes do not change the stable observation hash.
- [ ] **T-7.4** `packages/opencode/test/provider/...` or `test/session/...` — add tests that Anthropic requests include prompt cache metadata on stable prompt blocks.
- [ ] **T-7.5** `packages/opencode/test/session/...` — add tests for semantic recall reuse on short same-topic follow-ups and refresh on topic shift.

---

## T-8 — Verification

- [ ] **T-8.1** `bun typecheck` from `packages/opencode` — 0 errors
- [ ] **T-8.2** Run focused prompt/memory/provider tests from `packages/opencode` — 0 failures
- [ ] **T-8.3** Verify no memory budgets were reduced as part of the change
