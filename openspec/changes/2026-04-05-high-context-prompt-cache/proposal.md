# Proposal: high-context-prompt-cache

## Intent

Improve prompt cache hit rate in LightCode's native memory runtime **without reducing memory budgets**. The current system is optimized for memory quality and high-context workflows, but stable memory layers are injected as large system blocks without provider-level prompt cache metadata or block identity. This causes small user turns to inherit large prompt churn and weaker cache reuse than systems like Mastra.

## Scope

### In Scope

- Add prompt-block identity (`hash`, `tokens`, `stability`) for memory layers produced by `Memory.buildContext()`
- Assemble system prompt in deterministic cache-aware blocks instead of anonymous string slots
- Add provider-aware prompt cache metadata for stable system/memory blocks
- Split observations into stable vs volatile segments so small hints do not invalidate large memory payloads
- Reuse semantic recall across short same-topic follow-ups when still valid
- Add per-layer prompt/cache instrumentation and regression tests
- Modify `memory` capability requirements to describe cache-aware high-context prompt assembly

### Out of Scope

- Lowering `workingMemoryBudget`, `observationsBudget`, or `semanticRecallBudget`
- Rewriting the native memory architecture or replacing `Memory.buildContext()`
- Changing the semantics of `thread`, `agent`, `project`, `user`, or dormant `global_pattern`
- Building provider-specific caching hacks outside the existing `ProviderTransform` path

## Capabilities

### Modified Capabilities

- `memory`: prompt assembly, memory block formatting, semantic recall reuse, provider-aware cache metadata

## Approach

1. Instrument prompt construction so each request records token counts and hashes for header, working memory, observations, recall, and live messages.
2. Extend `Memory.buildContext()` to return block metadata instead of opaque strings only.
3. Introduce deterministic prompt block assembly in `session/llm.ts` and keep stable blocks ordered before volatile blocks.
4. Add provider-aware prompt cache metadata through `ProviderTransform` for stable blocks.
5. Split observation payloads into stable memory vs volatile hints and reuse recall across same-topic short follow-ups.

## Success Criteria

- [ ] High-context memory budgets remain unchanged by default
- [ ] Stable prompt blocks have hashes and token accounting
- [ ] Anthropic requests include cache metadata on stable prompt blocks, not just tools
- [ ] Same-topic follow-up turns reuse recall when valid instead of rebuilding it every turn
- [ ] Small volatile observation changes do not invalidate the full stable observation payload
- [ ] Typecheck and focused prompt/memory tests pass
