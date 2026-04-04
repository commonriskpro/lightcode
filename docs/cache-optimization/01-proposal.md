# Change Proposal: Cache-Optimized Context Management

## Intent

Restructure LightCode's prompt assembly and compaction system to maximize prompt cache hits across Anthropic, OpenAI, and Google Gemini — reducing input token costs by ~74% on a typical 10-turn session without changing user-visible behavior.

## Problem

LightCode currently wastes cache budget in three ways:

1. **Breakpoint misplacement**: 2 of 4 Anthropic cache breakpoints are placed on the last 2 conversation messages — content that changes every turn. These generate cache writes (1.25× cost) that are never read back. Pure waste.

2. **Unstable system prefix**: The second system message includes `Today's date: <date>` which changes daily, invalidating the cache for AGENTS.md, skills, and instructions — typically 3,000-8,000 tokens that are otherwise stable across all turns within a day.

3. **Compaction destroys all cache**: Full-replacement compaction replaces the entire conversation with a summary. On the first post-compaction turn, all conversation tokens go from cache-read (0.1×) to cache-write (1.25×) — a 12.5× cost spike.

## Scope

### In Scope

- **Phase 1 — Breakpoint optimization**: Restructure `applyCaching()` in `transform.ts` to use all 4 Anthropic breakpoints, placed by content volatility (tools → agent prompt → env/instructions → conversation prefix)
- **Phase 2 — System prompt stabilization**: Extract volatile data (date, model name) from the cached system message into a per-turn injection point that doesn't invalidate upstream cache
- **Phase 3 — Cut-point compaction**: Replace full-replacement compaction with a cut-point strategy that keeps recent messages verbatim, preserving their cache entries across compaction boundaries
- **Phase 4 — Iterative summaries**: When re-compacting, update the previous summary instead of generating from scratch

### Out of Scope

- Gemini explicit cache API (separate cache objects) — different paradigm, separate feature
- OpenAI `prompt_cache_retention: "24h"` — small change, can be a follow-up PR
- Token-level sliding window pruning — LightCode's pruning layer already handles this
- Changes to the AI SDK's caching behavior — we work within the existing SDK surface
- Changes to output token handling — caching only affects input tokens

## Approach

### Phase 1 — Breakpoint Optimization

Replace the current `applyCaching()` logic that caches `system[0..1]` + `last_2_messages` with a 4-breakpoint scheme ordered by content volatility:

| Breakpoint | Content                                                 | TTL  | Stability                                     |
| ---------- | ------------------------------------------------------- | ---- | --------------------------------------------- |
| BP1        | Tool definitions (via AI SDK providerOptions on tools)  | 1hr  | Very high — changes only on MCP reconnect     |
| BP2        | Agent prompt (system message 1)                         | 1hr  | High — changes only on agent switch           |
| BP3        | Environment + skills + AGENTS.md (system message 2)     | 5min | Medium — date changes daily, rest stable      |
| BP4        | Conversation history (second-to-last assistant message) | 5min | Grows — each turn adds, old msgs never change |

The key insight: Anthropic's prefix order is `tools → system → messages`. By caching tools and the agent prompt with 1-hour TTL, they survive idle periods. BP4 on the second-to-last message (not the last) means it's always a read on the next turn.

### Phase 2 — System Prompt Stabilization

Move the volatile date line from the system prompt's environment section into a per-turn user message injection (or into a position AFTER the last breakpoint). This makes system message 2 stable within a session.

### Phase 3 — Cut-Point Compaction

Instead of summarizing the full conversation and replacing everything:

1. Find a "cut point" — the boundary between old context (to be summarized) and recent context (to be kept verbatim)
2. Summarize everything before the cut point
3. Inject the summary as a compaction message
4. Keep everything after the cut point as-is

This preserves cache entries for recent messages. The `filterCompacted()` function already supports this structure — it stops at the first compaction boundary walking from newest to oldest.

### Phase 4 — Iterative Summaries

When compacting a session that has already been compacted, pass the previous summary to the LLM with explicit instructions to UPDATE rather than regenerate. This prevents information loss across multiple compactions.

## Risks

| Risk                                                  | Impact                     | Mitigation                                                                                                      |
| ----------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Anthropic rejects 1hr TTL breakpoints after 5min ones | API 400 error              | Enforce TTL ordering: 1hr breakpoints always before 5min. Add a sort/validate step.                             |
| Cut-point compaction keeps too many tokens            | Context grows faster       | Use `keepRecentTokens` parameter (default 20K) as budget, same as Pi.                                           |
| Iterative summary grows unbounded                     | Summary bloats over time   | Cap summary at 80% of reserve tokens (same as Pi).                                                              |
| AI SDK doesn't pass cache_control on tools            | Breakpoint 1 has no effect | Verify with Anthropic SDK. If not supported, use top-level automatic caching.                                   |
| Cut-point finds no valid boundary                     | Edge case                  | Fall back to full-replacement compaction (current behavior).                                                    |
| Providers that don't support caching                  | No benefit but no harm     | Breakpoints are no-ops for providers without cache support.                                                     |
| Plugin-modified system prompt invalidates BP2         | Lost agent prompt cache    | Plugin transform hook runs AFTER BP2 placement. If it modifies system[0], cache misses but behavior is correct. |

## Rollback Plan

Each phase is independent and behind checks:

- **Phase 1**: Revert `applyCaching()` to the original 2-system + 2-final strategy
- **Phase 2**: Move date back into system prompt
- **Phase 3**: `filterCompacted()` already supports both strategies — the compaction method is the only change point
- **Phase 4**: Remove the "UPDATE" prompt and previous-summary injection

No database migrations. No schema changes. No new config keys (existing `compaction.auto`, `compaction.reserved` are reused). No user-visible behavior changes.
