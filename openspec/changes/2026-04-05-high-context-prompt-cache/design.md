# Design: high-context-prompt-cache

## Overview

LightCode's current prompt pipeline optimizes for memory richness, but not for prompt cache stability. `Memory.buildContext()` can inject large `workingMemory`, `observations`, and `semanticRecall` blocks, and `LLM.stream()` currently treats them as positional strings. Comments in `session/llm.ts` describe cache breakpoints, but the implementation only applies explicit Anthropic `cacheControl` to the final tool definition. This change keeps the high-context architecture intact and makes it structurally cacheable.

---

## Design Goals

1. Preserve high-context workflows — **no budget reduction**.
2. Improve provider-side prompt cache hit rate through stable block identity and cache metadata.
3. Keep `Memory.buildContext()` as the canonical composition path.
4. Avoid waking dormant `global_pattern` or rewriting memory semantics.
5. Make prompt churn observable with per-layer hashes and token accounting.

---

## Change 1 — Memory blocks become typed prompt artifacts

**Files:**

- `packages/opencode/src/memory/contracts.ts`
- `packages/opencode/src/memory/provider.ts`

### Problem

`Memory.buildContext()` returns formatted strings only. Downstream code cannot tell which block changed, how expensive it is, or whether it is stable enough to cache.

### Design

Add a block-level type:

```ts
type PromptBlockKey = "working_memory" | "observations_stable" | "observations_live" | "semantic_recall"

type PromptBlock = {
  key: PromptBlockKey
  body: string
  hash: string
  tokens: number
  stable: boolean
}
```

`MemoryContext` keeps convenience fields for compatibility during rollout, but also exposes `blocks: PromptBlock[]`.

### Notes

- `working_memory` is stable.
- `observations_stable` is stable/semi-stable.
- `observations_live` is volatile.
- `semantic_recall` is semi-stable.

---

## Change 2 — Split observations into stable vs volatile blocks

**Files:**

- `packages/opencode/src/session/system.ts`
- `packages/opencode/src/memory/provider.ts`

### Problem

Observations are currently emitted as a monolithic block. A tiny volatile hint (`suggested_continuation`, current task, turn-local guidance) can invalidate the whole observation payload.

### Design

Refactor `SystemPrompt.observations()` into composable helpers:

- `SystemPrompt.observationsStable(rec)`
- `SystemPrompt.observationsLive(rec)`

`observationsStable` contains:

- reflections when present, else consolidated observations
- observation-group retrieval instructions when needed

`observationsLive` contains:

- `suggested_continuation`
- current task hint if exposed here
- short volatile reminders related to turn continuity

### Why

This isolates the expensive portion of observations from the fast-changing one, improving prefix reuse without shrinking context.

---

## Change 3 — Deterministic prompt assembly in `LLM.stream()`

**File:** `packages/opencode/src/session/llm.ts`

### Problem

Prompt parts are currently spliced into `system[]` as raw strings. This makes block identity implicit and cache policies hard to apply correctly.

### Design

Replace string-only assembly with a deterministic internal block list, then render it into provider-ready messages.

### Stable order

1. provider base prompt
2. agent prompt
3. stable instructions / skills / environment that rarely change
4. working memory
5. stable observations
6. semantic recall
7. volatile observation/live hints
8. volatile model/date block
9. live message tail

### Constraints

- Order MUST NOT depend on optional branch order.
- Empty optional blocks should be omitted consistently.
- Compatibility with existing plugin transforms must be preserved.

---

## Change 4 — Provider-aware prompt cache metadata

**Files:**

- `packages/opencode/src/provider/transform.ts`
- `packages/opencode/src/session/llm.ts`

### Problem

LightCode currently applies explicit cache metadata only to the last tool definition for Anthropic. Stable prompt blocks do not carry provider cache hints.

### Design

Add a provider-aware helper:

```ts
ProviderTransform.promptCache(model, blocks)
```

This helper maps stable prompt blocks to provider metadata.

### Anthropic

Apply `cacheControl: { type: "ephemeral", ttl: "1h" }` to stable prompt blocks chosen as breakpoints.

### OpenAI / gateway

If the target provider exposes prompt-cache APIs (for example prompt cache key / retention), route them through `providerOptions` without inventing a parallel path.

### Fallback

Unsupported providers receive no-op metadata.

---

## Change 5 — Recall reuse policy for same-topic follow-ups

**Files:**

- `packages/opencode/src/session/prompt.ts`
- new helper: `packages/opencode/src/memory/query-reuse.ts` (or equivalent)

### Problem

Semantic recall is recomputed from `lastUserText(msgs)` at step 1 and can churn unnecessarily on short follow-up turns within the same topic flow.

### Design

Persist lightweight session-local recall state:

- last semantic query
- recall hash
- normalized topic key / cluster marker

Reuse recall when:

- the new user turn is a short same-topic follow-up
- no exact historical reproduction is requested
- no domain shift is detected

Refresh recall when:

- the topic changes materially
- the user requests exact historical details
- ambiguity or missing evidence is detected

### Why

This reduces avoidable churn in one of the most expensive prompt layers without lowering budgets.

---

## Change 6 — Per-layer prompt/cache instrumentation

**Files:**

- `packages/opencode/src/session/llm.ts`
- optional helper: `packages/opencode/src/session/prompt-cache.ts`

### Problem

We cannot improve cache hit rate safely without observing what changes between turns.

### Design

Emit structured diagnostics per request:

- `headerHash`
- `wmHash`
- `obsStableHash`
- `obsLiveHash`
- `recallHash`
- token counts per layer
- provider cache read/write counters when available

This can be log-only initially; no user-facing UI is required in the first pass.

---

## Change 7 — Rollout strategy

### Phase A

- block metadata
- instrumentation
- deterministic assembly

### Phase B

- Anthropic prompt cache metadata on stable blocks
- tests for stable ordering and metadata emission

### Phase C

- split observations stable/live
- recall reuse policy
- provider-specific follow-up tuning

---

## Risks and Mitigations

| Risk                                    | Why it matters                                  | Mitigation                                                                 |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Stable ordering regression              | Small assembly changes can destroy prefix reuse | Add tests for exact block order and presence/absence rules                 |
| Provider cache metadata incompatibility | Providers expose different APIs                 | Contain all mapping in `ProviderTransform`                                 |
| Over-caching stale recall               | Same-topic heuristic may be too permissive      | Reuse only on short follow-ups and invalidate on ambiguity/topic shift     |
| Plugin transform interference           | Plugins can mutate system/messages              | Apply cache metadata after final block assembly and test transformed flows |

---

## Test Plan

### Unit

- `Memory.buildContext()` returns block hashes/tokens/stability metadata
- observations stable/live split is deterministic
- provider prompt-cache mapping is correct per provider

### Integration

- identical high-context turns preserve stable block hashes
- volatile observation hint changes do not change stable observation hash
- Anthropic requests include prompt cache metadata on stable blocks
- recall is reused on short same-topic follow-ups and refreshed on topic shift

---

## Success Metrics

1. Stable block hashes remain unchanged across short same-topic follow-ups.
2. Cache-read tokens increase on providers that expose prompt caching.
3. Total input tokens stay high-context, but reprocessed prompt cost drops.
4. No reduction in memory budgets is required to achieve better cache behavior.
